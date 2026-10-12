"""Steam achievements for each user: what the Deck synced, filled in from the Steam Web API.

The Deck reads achievements from the Steam client and uploads them (PUT /api/achievements). When the server has
a STEAM_API_KEY and the user signed in with Steam, it also fetches them itself, so the website stays current
while the Deck is off. Per game, the newest data wins. Stdlib only, like the rest of the server.
"""
import json
import os
import threading
import time
import urllib.parse
import urllib.request

KEY = os.environ.get("STEAM_API_KEY", "").strip()
API = "https://api.steampowered.com"
DATA = os.environ.get("DATA_DIR", "/data")
SCHEMA_DIR = os.path.join(DATA, "steam_schema")
SCHEMA_DAYS = 7
WEB_EVERY = 3600  # seconds between Web API refreshes for one user
PER_RUN = 40  # games fetched per refresh, so a big library fills in over a few runs

_lock = threading.Lock()
_running = set()


def path(root: str) -> str:
    return os.path.join(root, "achievements.json")


def load(root: str) -> dict:
    try:
        with open(path(root)) as f:
            return json.load(f)
    except (OSError, ValueError):
        return {"updatedAt": 0, "games": {}}


def save(root: str, data: dict):
    os.makedirs(root, exist_ok=True)
    tmp = path(root) + ".tmp"
    with open(tmp, "w") as f:
        json.dump(data, f)
    os.replace(tmp, path(root))


def merge(old: dict, new: dict) -> dict:
    """Per game, the newer record wins; a newer record without a list keeps the older list."""
    games = dict(old.get("games") or {})
    for appid, g in (new.get("games") or {}).items():
        if not isinstance(g, dict):
            continue
        prev = games.get(appid)
        if prev and (prev.get("updatedAt") or 0) > (g.get("updatedAt") or 0):
            continue
        games[appid] = {**(prev or {}), **g}
    out = {**old, "games": games, "updatedAt": max(old.get("updatedAt") or 0, new.get("updatedAt") or 0)}
    return out


def put(root: str, incoming: dict) -> dict:
    with _lock:
        data = merge(load(root), incoming)
        save(root, data)
    return data


# ---------- Steam Web API ----------

def _get(method: str, params: dict, timeout=20):
    url = f"{API}/{method}/?" + urllib.parse.urlencode(params)
    with urllib.request.urlopen(url, timeout=timeout) as resp:
        return json.loads(resp.read())


def _schema(appid: str) -> dict:
    """Names, icons and hidden flags for a game's achievements, plus the global unlock %. Shared by all users."""
    os.makedirs(SCHEMA_DIR, exist_ok=True)
    p = os.path.join(SCHEMA_DIR, f"{appid}.json")
    if os.path.exists(p) and time.time() - os.path.getmtime(p) < SCHEMA_DAYS * 86400:
        with open(p) as f:
            return json.load(f)
    out = {}
    try:
        game = _get("ISteamUserStats/GetSchemaForGame/v2", {"key": KEY, "appid": appid, "l": "english"}).get("game") or {}
        for a in (game.get("availableGameStats") or {}).get("achievements") or []:
            out[a["name"]] = {"name": a.get("displayName") or a["name"], "description": a.get("description", ""),
                              "icon": a.get("icon", ""), "iconGray": a.get("icongray", ""), "hidden": bool(a.get("hidden"))}
    except Exception:
        pass
    try:
        pct = _get("ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2", {"gameid": appid})
        for a in (pct.get("achievementpercentages") or {}).get("achievements") or []:
            out.setdefault(a["name"], {})["globalPct"] = round(float(a.get("percent") or 0), 1)
    except Exception:
        pass
    with open(p + ".tmp", "w") as f:
        json.dump(out, f)
    os.replace(p + ".tmp", p)
    return out


def _game(steam_id: str, appid: str, name: str):
    try:
        res = _get("ISteamUserStats/GetPlayerAchievements/v1", {"key": KEY, "steamid": steam_id, "appid": appid})
    except Exception:
        return None  # no achievements, or private game details
    stats = res.get("playerstats") or {}
    if not stats.get("success") or not stats.get("achievements"):
        return None
    schema = _schema(appid)
    lst = []
    for a in stats["achievements"]:
        info = schema.get(a["apiname"], {})
        lst.append({
            "id": a["apiname"],
            "name": info.get("name") or a["apiname"],
            "description": info.get("description", ""),
            "icon": info.get("icon", ""),
            "iconGray": info.get("iconGray", ""),
            "hidden": bool(info.get("hidden")),
            "unlockedAt": int(a.get("unlocktime") or (1 if a.get("achieved") else 0)) if a.get("achieved") else 0,
            **({"globalPct": info["globalPct"]} if "globalPct" in info else {}),
        })
    return {"appId": appid, "name": stats.get("gameName") or name, "unlocked": sum(1 for a in lst if a["unlockedAt"]),
            "total": len(lst), "list": lst, "updatedAt": int(time.time() * 1000)}


def refresh(root: str, steam_id: str, force: bool = False) -> bool:
    """Fill in this user's achievements from the Web API (blocking). False when there's no key, no Steam ID,
    or it ran lately."""
    if not KEY or not steam_id:
        return False
    data = load(root)
    web = data.get("web") or {}
    if not force and time.time() - (web.get("at") or 0) < WEB_EVERY:
        return False
    owned = (_get("IPlayerService/GetOwnedGames/v1", {"key": KEY, "steamid": steam_id, "include_appinfo": 1,
                                                       "include_played_free_games": 1}).get("response") or {}).get("games") or []
    checked = web.get("checked") or {}
    now = time.time()
    played = sorted((g for g in owned if g.get("playtime_forever")), key=lambda g: -(g.get("rtime_last_played") or 0))

    def due(g):
        at = checked.get(str(g["appid"]))
        # Never asked, played since, or a week old (Steam's global % drift; achievements get added).
        return at is None or (g.get("rtime_last_played") or 0) > at or now - at > 7 * 86400

    todo = [g for g in played if due(g)][:PER_RUN]
    fresh = {}
    for g in todo:
        appid = str(g["appid"])
        rec = _game(steam_id, appid, g.get("name") or appid)
        checked[appid] = now
        if rec:
            rec["playtimeMin"] = g.get("playtime_forever") or 0
            rec["lastPlayed"] = g.get("rtime_last_played") or 0
            fresh[appid] = rec
    # Playtime for every owned game we already know, without asking about each one again.
    with _lock:
        data = merge(load(root), {"games": fresh})
        for g in owned:
            rec = data["games"].get(str(g["appid"]))
            if rec:
                rec["playtimeMin"] = g.get("playtime_forever") or rec.get("playtimeMin") or 0
                rec["lastPlayed"] = g.get("rtime_last_played") or rec.get("lastPlayed") or 0
        data["web"] = {"at": now, "checked": checked}
        data["playtime"] = {str(g["appid"]): g.get("playtime_forever") or 0 for g in owned if g.get("playtime_forever")}
        data["names"] = {str(g["appid"]): g.get("name") for g in owned if g.get("playtime_forever")}
        save(root, data)
    return True


def refresh_later(root: str, steam_id: str, force: bool = False):
    """Runs refresh() in the background, once at a time per user."""
    if not KEY or not steam_id or root in _running:
        return
    _running.add(root)

    def run():
        try:
            refresh(root, steam_id, force)
        except Exception as e:
            print("achievements: web refresh failed:", e)
        finally:
            _running.discard(root)
    threading.Thread(target=run, daemon=True).start()


def public(data: dict) -> dict:
    """What clients get: the games, without the server's bookkeeping."""
    return {"updatedAt": data.get("updatedAt") or 0, "games": data.get("games") or {},
            "webApi": bool(KEY), "refreshing": False}
