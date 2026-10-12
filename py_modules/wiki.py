"""Wikis for the 📖 Wiki Scroll: finding a game's wiki, and searching one. Standard library only, so the plugin and
the server both use it. Pages themselves are read through reader.py (which already asks MediaWiki for just the
article), so they're cached on the server like any other reader page.

Works with MediaWiki sites: Fandom, wiki.gg, Wikipedia and most self-hosted game wikis."""

import json
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

# wiki.gg turns away browser-looking agents without a browser; MediaWiki asks API users to say who they are.
USER_AGENT = "DeskOfMadness/0.3 (+https://github.com/Marshy-Madness/desk-of-madness)"
MAX_BYTES = 2 * 1024 * 1024
SITE_TTL = 24 * 3600
FIND_TTL = 7 * 24 * 3600
WIKIPEDIA = "https://en.wikipedia.org"

_sites: dict = {}  # base URL → (time, site or None)
_found: dict = {}  # game name → (time, [sites])
_lock = threading.Lock()


def _get_json(url: str, context=None, timeout: int = 15):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout, context=context) as resp:
        return json.loads(resp.read(MAX_BYTES))


def _base(url: str) -> str:
    """https://host[/lang] for anything on a wiki: a page link, the home page or just its name."""
    url = (url or "").strip()
    if not re.match(r"^https?://", url, re.I):
        url = "https://" + url
    parts = urllib.parse.urlsplit(url)
    if not parts.hostname:
        raise ValueError("That isn't a wiki address")
    lang = re.match(r"^/([a-z]{2,3}(?:-[a-z]+)?)/wiki(/|$)", parts.path)
    return f"https://{parts.netloc.lower()}" + (f"/{lang.group(1)}" if lang else "")


def site(url: str, context=None) -> dict:
    """{base, api, name, home, logo, articlePath} for the MediaWiki that `url` is on. Raises ValueError if it
    isn't one (or can't be reached)."""
    base = _base(url)
    now = time.time()
    with _lock:
        hit = _sites.get(base)
    if hit and now - hit[0] < SITE_TTL:
        if hit[1] is None:
            raise ValueError("That site isn't a wiki Desk can search")
        return hit[1]
    found = None
    for path in ("/api.php", "/w/api.php"):
        api = base + path
        q = urllib.parse.urlencode({"action": "query", "meta": "siteinfo", "siprop": "general", "format": "json",
                                    "formatversion": "2"})
        try:
            data = _get_json(f"{api}?{q}", context)
        except (urllib.error.URLError, ValueError, OSError):
            continue
        g = (data.get("query") or {}).get("general") if isinstance(data, dict) else None
        if not g:
            continue
        server = g.get("server") or base
        if server.startswith("//"):
            server = "https:" + server
        article = g.get("articlepath") or "/wiki/$1"
        logo = g.get("logo") or None
        if logo and logo.startswith("//"):
            logo = "https:" + logo
        found = {"base": base, "api": api, "name": g.get("sitename") or base, "logo": logo,
                 "articlePath": server + article}
        # The main page by its title, so it opens through the API like every other page.
        found["home"] = page_url(found, g["mainpage"]) if g.get("mainpage") else (g.get("base") or base)
        break
    with _lock:
        _sites[base] = (now, found)
    if not found:
        raise ValueError("That site isn't a wiki Desk can search")
    return found


def page_url(s: dict, title: str) -> str:
    return s["articlePath"].replace("$1", urllib.parse.quote(title.replace(" ", "_"), safe="/:()',!*"))


def _slugs(name: str) -> list:
    words = re.findall(r"[a-z0-9]+", re.sub(r"['’]", "", name.lower()))
    words = [w for w in words if w not in ("the", "tm", "r")] or words
    if not words:
        return []
    # Edition and subtitle words that wikis usually leave out of their address.
    trimmed = [w for w in words if w not in ("remastered", "definitive", "edition", "goty", "deluxe", "complete",
                                              "enhanced", "directors", "cut", "game", "of", "year")] or words
    out = []
    for ws in (words, trimmed, trimmed[:2], trimmed[:1]):
        for s in ("".join(ws), "-".join(ws)):
            if len(s) > 2 and s not in out:
                out.append(s)
    return out[:8]


def find(name: str, context=None) -> list:
    """Wikis for a game, best first: Fandom and wiki.gg sites named after it, then Wikipedia."""
    key = re.sub(r"\s+", " ", (name or "").strip().lower())
    if not key:
        return []
    now = time.time()
    with _lock:
        hit = _found.get(key)
    if hit and now - hit[0] < FIND_TTL:
        return hit[1]
    candidates = [f"https://{slug}.{host}" for slug in _slugs(name) for host in ("wiki.gg", "fandom.com")]
    results: dict = {}

    def probe(url):
        try:
            results[url] = site(url, context)
        except ValueError:
            pass

    threads = [threading.Thread(target=probe, args=(u,), daemon=True) for u in candidates]
    for t in threads:
        t.start()
    for t in threads:
        t.join(20)
    out, seen = [], set()
    for u in candidates:  # keep the candidates' order: full name before shorter guesses, wiki.gg before Fandom
        s = results.get(u)
        if s and s["home"] not in seen:
            seen.add(s["home"])
            out.append(s)
    try:
        out.append(site(WIKIPEDIA, context))
    except ValueError:
        pass
    with _lock:
        _found[key] = (now, out)
    return out


def _plain(snippet: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", snippet or "")).replace("&quot;", '"').replace("&amp;", "&") \
        .replace("&#039;", "'").replace("&lt;", "<").replace("&gt;", ">").strip()


def search(url: str, q: str, limit: int = 20, context=None) -> list:
    """[{title, url, snippet}] for `q` on the wiki at `url`, best match first."""
    s = site(url, context)
    q = (q or "").strip()[:200]
    if not q:
        return []
    params = urllib.parse.urlencode({"action": "query", "list": "search", "srsearch": q, "srlimit": max(1, min(limit, 50)),
                                     "srprop": "snippet", "srnamespace": "0", "format": "json", "formatversion": "2"})
    try:
        data = _get_json(f"{s['api']}?{params}", context, timeout=20)
    except (urllib.error.URLError, OSError) as e:
        raise ValueError(f"Couldn't reach {s['name']}: {getattr(e, 'reason', e)}")
    hits = ((data.get("query") or {}).get("search") or []) if isinstance(data, dict) else []
    return [{"title": h["title"], "url": page_url(s, h["title"]), "snippet": _plain(h.get("snippet", ""))[:240]}
            for h in hits if h.get("title")]


# ---------- the wikis picked for each game (synced between the Deck and the website) ----------
# {appId: {"wikis": [site, …], "at": ms}}. The first wiki is the game's main one; an empty list means "none picked"
# (kept, so forgetting a game's wikis reaches the other devices). Per game, the newer pick wins.

MAX_PER_GAME = 12
_SITE_KEYS = ("base", "api", "name", "home", "logo", "articlePath")


def _clean_site(w) -> dict:
    if not isinstance(w, dict) or not all(isinstance(w.get(k), str) and w.get(k) for k in ("base", "api", "home", "articlePath")):
        return None
    if not all(re.match(r"^https?://", w[k], re.I) for k in ("base", "api", "home", "articlePath")):
        return None
    out = {k: w.get(k) for k in _SITE_KEYS}
    out["name"] = str(out.get("name") or out["base"])[:120]
    if not isinstance(out.get("logo"), str):
        out["logo"] = None
    return out


def clean_choice(c) -> dict:
    """One game's pick, or None if it's malformed. Drops bad and repeated wikis."""
    if not isinstance(c, dict) or not isinstance(c.get("wikis"), list):
        return None
    wikis, seen = [], set()
    for w in c["wikis"]:
        w = _clean_site(w)
        if w and w["base"] not in seen:
            seen.add(w["base"])
            wikis.append(w)
    try:
        at = int(c.get("at") or 0)
    except (TypeError, ValueError):
        at = 0
    return {"wikis": wikis[:MAX_PER_GAME], "at": at}


def merge_choices(old: dict, new: dict) -> dict:
    """Both are {appId: {"wikis", "at"}}; per game the newer one wins (ties keep the old one)."""
    out = {str(k): v for k, v in (old or {}).items() if clean_choice(v)}
    for appid, c in (new or {}).items():
        c = clean_choice(c)
        if not c:
            continue
        prev = out.get(str(appid))
        if prev and (prev.get("at") or 0) >= c["at"]:
            continue
        out[str(appid)] = c
    return out


if __name__ == "__main__":  # python3 wiki.py "Elden Ring" [query]
    import sys
    sites = find(sys.argv[1])
    print(json.dumps(sites, indent=1))
    if len(sys.argv) > 2 and sites:
        print(json.dumps(search(sites[0]["home"], sys.argv[2], 5), indent=1))
