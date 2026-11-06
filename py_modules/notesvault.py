"""Talks to a Madness Notes server's vault API (Bearer API token) for quick capture and game-linked notes."""
import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request

import decky
from sync import _SSL as SSL_CONTEXT

DEFAULT_SERVER = "https://notes.marshymadness.com"
LINKS_PATH = os.path.join(decky.DECKY_PLUGIN_SETTINGS_DIR, "notes_links.json")
INBOX = "Deck Inbox.md"
GAMES_FOLDER = "Games"


class VaultError(Exception):
    def __init__(self, message: str, code: int = 0):
        super().__init__(message)
        self.code = code


def _cfg(settings: dict):
    server = (settings.get("notesServerUrl") or DEFAULT_SERVER).rstrip("/")
    token = (settings.get("notesToken") or "").strip()
    vault = (settings.get("notesVaultId") or "").strip()
    return server, token, vault


def _request(server: str, token: str, method: str, path: str, body=None, timeout: int = 20):
    data = None if body is None else json.dumps(body).encode("utf-8")
    req = urllib.request.Request(server + path, data=data, method=method)
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("User-Agent", "DeskOfMadness")
    if data is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=SSL_CONTEXT) as resp:
            raw = resp.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        detail = ""
        try:
            detail = json.loads(e.read().decode("utf-8")).get("error", "")
        except Exception:  # noqa: BLE001
            pass
        if e.code in (401, 403) and not detail:
            detail = "the token was refused" if e.code == 401 else "not allowed"
        raise VaultError(detail or f"server answered {e.code}", e.code) from e
    except urllib.error.URLError as e:
        raise VaultError(f"can't reach the server ({e.reason})") from e
    return json.loads(raw) if raw else None


def list_vaults(settings: dict) -> list:
    server, token, _ = _cfg(settings)
    if not token:
        raise VaultError("add an API token first")
    vaults = _request(server, token, "GET", "/api/vaults") or []
    return [{"id": v["id"], "name": v["name"], "role": v.get("role", "")} for v in vaults if not v.get("partial")]


def _rpc(settings: dict, command: str, args=None):
    server, token, vault = _cfg(settings)
    if not token or not vault:
        raise VaultError("pick a Madness Notes vault in Desk of Madness settings")
    return _request(server, token, "POST", f"/api/vaults/{vault}/rpc/{command}", args if args is not None else {})


def _read(settings: dict, path: str):
    try:
        return _rpc(settings, "read_note", {"path": path})
    except VaultError as e:
        if e.code and e.code not in (401, 403, 429) and e.code < 500 or "Not a file" in str(e):
            return None
        raise


def _write(settings: dict, path: str, content: str, base):
    if "/" in path:
        try:
            _rpc(settings, "create_folder", {"path": path.rsplit("/", 1)[0]})
        except VaultError:
            pass
    return _rpc(settings, "write_note", {"path": path, "content": content, "base": base})


def _safe_title(name: str) -> str:
    name = re.sub(r'[\\/:*?"<>|#^\[\]]', " ", name or "").strip()
    return re.sub(r"\s+", " ", name) or "Untitled game"


def _links() -> dict:
    try:
        with open(LINKS_PATH) as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def _save_link(appid: str, path: str):
    links = _links()
    links[appid] = path
    os.makedirs(os.path.dirname(LINKS_PATH), exist_ok=True)
    with open(LINKS_PATH, "w") as f:
        json.dump(links, f)


def linked_path(appid: str) -> str:
    return _links().get(str(appid), "")


def capture(settings: dict, appid: str, game: str, text: str) -> dict:
    """Appends a line to the Deck Inbox note (created on first use). Concurrent edits merge on the server."""
    text = " ".join(text.split())
    if not text:
        raise VaultError("nothing to save")
    stamp = time.strftime("%Y-%m-%d %H:%M")
    title = _safe_title(game)
    link = linked_path(appid)
    where = f"[[{link[:-3]}|{title}]]" if link.endswith(".md") else title
    line = f"- {stamp} ({where}) {text}"
    current = _read(settings, INBOX)
    if current is None:
        content = f"---\ntags: [deck-inbox]\n---\n# Deck Inbox\n\nQuick notes from the Steam Deck.\n\n{line}\n"
        _write(settings, INBOX, content, None)
    else:
        content = current if current.endswith("\n") else current + "\n"
        _write(settings, INBOX, content + line + "\n", current)
    return {"path": INBOX}


def game_note(settings: dict, appid: str, game: str, create: bool = True) -> dict:
    """The vault note linked to a game. Created (with a steam-appid property) when asked and not there yet."""
    appid = str(appid)
    path = linked_path(appid)
    if path and _read(settings, path) is not None:
        return {"path": path, "created": False}
    if not create:
        return {"path": "", "created": False}
    path = f"{GAMES_FOLDER}/{_safe_title(game)}.md"
    existing = _read(settings, path)
    if existing is None:
        content = f"---\nsteam-appid: {appid}\ntags: [game]\n---\n# {_safe_title(game)}\n\n"
        _write(settings, path, content, None)
    _save_link(appid, path)
    return {"path": path, "created": existing is None}


def related(settings: dict, appid: str, game: str, limit: int = 6) -> list:
    """Linked note first, then notes that mention the game by name."""
    out = []
    link = linked_path(appid)
    if link:
        out.append({"path": link, "title": os.path.basename(link)[:-3] or link})
    hits = _rpc(settings, "search_notes", {"query": game, "limit": limit + 2}) or []
    for h in hits:
        if h["path"] != link and len(out) < limit:
            out.append({"path": h["path"], "title": h.get("title") or h["path"]})
    return out


def _edit(settings: dict, path: str, fn):
    """Read, change, write back with the version we read, so concurrent edits merge on the server."""
    current = _read(settings, path)
    if current is None:
        raise VaultError("the note is gone")
    updated = fn(current)
    if updated != current:
        _write(settings, path, updated, current)
    return updated


def _add_under(content: str, heading: str, line: str) -> str:
    """Appends a line to the end of a '## heading' section, adding the section when missing."""
    lines = content.rstrip("\n").split("\n")
    start = next((i for i, l in enumerate(lines) if l.strip().lower() == f"## {heading}".lower()), -1)
    if start < 0:
        return "\n".join(lines) + f"\n\n## {heading}\n\n{line}\n"
    end = next((i for i in range(start + 1, len(lines)) if lines[i].startswith("#")), len(lines))
    while end > start + 1 and not lines[end - 1].strip():
        end -= 1
    lines.insert(end, line)
    if end == start + 1:
        lines.insert(end, "")
    return "\n".join(lines) + "\n"


def read_game(settings: dict, appid: str, game: str) -> dict:
    """The game's note (created if needed) with its checklist items."""
    path = game_note(settings, appid, game, True)["path"]
    content = _read(settings, path) or ""
    tasks = []
    for i, l in enumerate(content.split("\n")):
        m = re.match(r"^\s*[-*] \[( |x|X)\] (.*)$", l)
        if m:
            tasks.append({"line": i, "done": m.group(1) != " ", "text": m.group(2)})
    return {"path": path, "content": content, "tasks": tasks}


def append_game(settings: dict, appid: str, game: str, text: str, heading: str = "") -> dict:
    text = " ".join(text.split())
    if not text:
        raise VaultError("nothing to save")
    path = game_note(settings, appid, game, True)["path"]
    task = re.match(r"^(?:- )?\[ \]\s*(.*)$", text)
    line = f"- [ ] {task.group(1)}" if task else f"- {time.strftime('%Y-%m-%d')} {text}"
    _edit(settings, path, lambda c: _add_under(c, heading or "Notes", line))
    return {"path": path}


def toggle_task(settings: dict, appid: str, game: str, line: int, done: bool) -> dict:
    path = game_note(settings, appid, game, False)["path"]
    if not path:
        raise VaultError("no note for this game yet")

    def change(c: str) -> str:
        lines = c.split("\n")
        if line < 0 or line >= len(lines) or not re.match(r"^\s*[-*] \[( |x|X)\] ", lines[line]):
            raise VaultError("that task moved; reopen the note")
        lines[line] = re.sub(r"\[( |x|X)\]", "[x]" if done else "[ ]", lines[line], count=1)
        return "\n".join(lines)

    _edit(settings, path, change)
    return {"path": path}


def log_session(settings: dict, appid: str, game: str, minutes: int, left_off: str = "") -> dict:
    path = game_note(settings, appid, game, True)["path"]
    line = f"- {time.strftime('%Y-%m-%d')}: played {max(1, int(minutes))} min"
    if left_off.strip():
        line += f". Left off: {' '.join(left_off.split())}"
    _edit(settings, path, lambda c: _add_under(c, "Play log", line))
    return {"path": path}


def add_screenshot(settings: dict, appid: str, game: str, file_path: str) -> dict:
    """Uploads an image to Attachments/Desk and embeds it in the game note."""
    server, token, vault = _cfg(settings)
    ext = os.path.splitext(file_path)[1].lower().lstrip(".") or "jpg"
    name = f"{appid}-{time.strftime('%Y%m%d-%H%M%S')}.{ext}"
    dest = f"Attachments/Desk/{name}"
    with open(file_path, "rb") as f:
        data = f.read()
    req = urllib.request.Request(
        f"{server}/api/vaults/{vault}/files/{urllib.parse.quote(dest)}", data=data, method="PUT"
    )
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("User-Agent", "DeskOfMadness")
    req.add_header("Content-Type", "application/octet-stream")
    try:
        urllib.request.urlopen(req, timeout=60, context=SSL_CONTEXT).read()
    except urllib.error.HTTPError as e:
        raise VaultError(f"upload failed ({e.code})", e.code) from e
    except urllib.error.URLError as e:
        raise VaultError(f"can't reach the server ({e.reason})") from e
    note = game_note(settings, appid, game, True)["path"]
    _edit(settings, note, lambda c: _add_under(c, "Screenshots", f"![[{name}]]"))
    return {"path": note, "file": dest}
