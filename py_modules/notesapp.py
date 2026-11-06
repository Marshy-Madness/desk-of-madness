"""Finds, downloads and updates the Madness Notes desktop AppImage on this Deck."""
import hashlib
import json
import os
import re
import threading
import urllib.request

import decky
from sync import _SSL as SSL_CONTEXT

DEFAULT_SERVER = "https://notes.marshymadness.com"
APP_DIR = os.path.join(decky.DECKY_USER_HOME, "Applications")
NAME_RE = re.compile(r"^MadnessNotes-(\d+(?:\.\d+)*)(?:[-.\w]*)\.AppImage$", re.I)

_progress = {"state": "idle", "done": 0, "total": 0, "error": "", "path": ""}
_lock = threading.Lock()


def version_of(path: str) -> str:
    m = NAME_RE.match(os.path.basename(path or ""))
    return m.group(1) if m else ""


def _key(v: str):
    return tuple(int(p) for p in re.findall(r"\d+", v))


def _own(path: str):
    """Plugins run as root; hand files to the Deck's user so the app can replace itself."""
    try:
        st = os.stat(decky.DECKY_USER_HOME)
        os.chown(path, st.st_uid, st.st_gid)
    except OSError:
        pass


def make_executable(path: str) -> bool:
    try:
        os.chmod(path, 0o755)
        return True
    except OSError:
        return False


def find() -> str:
    home = decky.DECKY_USER_HOME
    best = ""
    for folder in (APP_DIR, os.path.join(home, "Downloads"), os.path.join(home, "Desktop"),
                   os.path.join(home, ".local", "bin"), home):
        try:
            names = os.listdir(folder)
        except OSError:
            continue
        for name in names:
            path = os.path.join(folder, name)
            low = name.lower()
            if not (low.endswith(".appimage") and "madness" in low and "notes" in low and os.path.isfile(path)):
                continue
            if not best or _key(version_of(path)) > _key(version_of(best)):
                best = path
    return best


def remove_old(keep: str):
    """Deletes other Madness Notes AppImages (older builds) from the places find() looks in."""
    home = decky.DECKY_USER_HOME
    for folder in (APP_DIR, os.path.join(home, "Downloads"), os.path.join(home, "Desktop"),
                   os.path.join(home, ".local", "bin"), home):
        try:
            names = os.listdir(folder)
        except OSError:
            continue
        for name in names:
            path = os.path.join(folder, name)
            if path != keep and NAME_RE.match(name) and os.path.isfile(path):
                try:
                    os.remove(path)
                except OSError:
                    pass


def _get(url: str, timeout: int = 20):
    req = urllib.request.Request(url, headers={"User-Agent": "DeskOfMadness"})
    return urllib.request.urlopen(req, timeout=timeout, context=SSL_CONTEXT)


def check(server: str, installed_path: str) -> dict:
    server = (server or DEFAULT_SERVER).rstrip("/")
    with _get(server + "/api/updates") as resp:
        info = json.loads(resp.read().decode("utf-8"))
    latest = info.get("latest") or ""
    link = info.get("linux") or ""
    installed = version_of(installed_path)
    return {
        "latest": latest,
        "installed": installed,
        "available": bool(link),
        "newer": bool(link) and (not installed or _key(latest) > _key(installed)),
    }


def _download(server: str, link: str, latest: str, sha256: str):
    try:
        os.makedirs(APP_DIR, exist_ok=True)
        _own(APP_DIR)
        name = os.path.basename(link) or f"MadnessNotes-{latest}-x86_64.AppImage"
        if not NAME_RE.match(name):
            name = f"MadnessNotes-{latest}-x86_64.AppImage"
        dest = os.path.join(APP_DIR, name)
        part = dest + ".part"
        with _get(server.rstrip("/") + link, timeout=60) as resp, open(part, "wb") as out:
            with _lock:
                _progress["total"] = int(resp.headers.get("Content-Length") or 0)
            while True:
                chunk = resp.read(1 << 20)
                if not chunk:
                    break
                out.write(chunk)
                with _lock:
                    _progress["done"] += len(chunk)
        if sha256:
            h = hashlib.sha256()
            with open(part, "rb") as f:
                for block in iter(lambda: f.read(1 << 20), b""):
                    h.update(block)
            if h.hexdigest() != sha256.lower():
                os.remove(part)
                raise OSError("the download doesn't match the server's checksum")
        with _lock:
            if _progress["total"] and _progress["done"] != _progress["total"]:
                raise OSError("download was cut short")
        os.replace(part, dest)
        make_executable(dest)
        _own(dest)
        remove_old(dest)
        with _lock:
            _progress.update(state="done", path=dest)
    except Exception as e:  # noqa: BLE001 - shown to the user
        with _lock:
            _progress.update(state="error", error=str(e) or e.__class__.__name__)


def start_download(server: str) -> dict:
    server = (server or DEFAULT_SERVER).rstrip("/")
    with _lock:
        if _progress["state"] == "running":
            return dict(_progress)
    with _get(server + "/api/updates") as resp:
        info = json.loads(resp.read().decode("utf-8"))
    link = info.get("linux")
    if not link:
        raise RuntimeError("The server has no Linux build published yet")
    with _lock:
        _progress.update(state="running", done=0, total=0, error="", path="")
    threading.Thread(target=_download, args=(server, link, info.get("latest") or "", info.get("linuxSha256") or ""), daemon=True).start()
    return dict(_progress)


def progress() -> dict:
    with _lock:
        return dict(_progress)
