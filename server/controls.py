"""Home Assistant and Docker controls for Desk Commands (the Deck's command palette). Admins only.

Home Assistant: HA_URL + HA_TOKEN (a long-lived access token from your HA profile page). Lists the things
you can switch or run (lights, switches, fans, scenes, scripts...) and calls their services.

Docker: DOCKER_URL points at a socket proxy (never the raw socket) that only lets through listing and
start/stop/restart. DOCKER_PROTECT names containers the palette can't see or touch at all. Stdlib only, like the rest of the server.
"""
import json
import os
import re
import urllib.error
import urllib.request

HA_URL = os.environ.get("HA_URL", "").rstrip("/")
HA_TOKEN = os.environ.get("HA_TOKEN", "").strip()
DOCKER_URL = os.environ.get("DOCKER_URL", "").rstrip("/")
# Containers the palette may not stop (this server, its proxy). Restarting them is still allowed.
NO_STOP = {n.strip() for n in os.environ.get("DOCKER_NO_STOP", "desk-of-madness,desk-of-madness-docker").split(",") if n.strip()}
# Containers hidden from the palette and refused outright (the proxy, the reverse proxy, password manager...).
PROTECT = {n.strip() for n in os.environ.get("DOCKER_PROTECT", "desk-of-madness-docker").split(",") if n.strip()}

HA_DOMAINS = ("light", "switch", "fan", "input_boolean", "scene", "script", "automation", "cover", "media_player")
# Things that only run (no on/off state worth showing).
HA_RUN_ONLY = ("scene", "script")
HA_ACTIONS = ("toggle", "turn_on", "turn_off")
DOCKER_ACTIONS = ("start", "stop", "restart")


class ControlError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


def _call(method: str, url: str, headers: dict, body=None, timeout=10):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={**headers, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
    except urllib.error.HTTPError as e:
        if e.code in (401, 403):
            raise ControlError(502, "The token was rejected")
        if e.code == 404:
            raise ControlError(404, "Not found")
        if e.code == 304:  # Docker: already started/stopped
            return None
        raise ControlError(502, f"Error {e.code}")
    except (urllib.error.URLError, OSError) as e:
        raise ControlError(502, f"Can't reach it: {getattr(e, 'reason', e)}")
    return json.loads(raw) if raw else None


def status() -> dict:
    return {"home": bool(HA_URL and HA_TOKEN), "docker": bool(DOCKER_URL)}


# ---- Home Assistant ----

def _ha(method: str, path: str, body=None):
    if not (HA_URL and HA_TOKEN):
        raise ControlError(404, "Home Assistant isn't set up on the server (HA_URL and HA_TOKEN)")
    return _call(method, HA_URL + path, {"Authorization": f"Bearer {HA_TOKEN}"}, body)


def home_list() -> list:
    out = []
    for st in _ha("GET", "/api/states") or []:
        eid = st.get("entity_id", "")
        domain = eid.split(".", 1)[0]
        if domain not in HA_DOMAINS or st.get("state") in ("unavailable",):
            continue
        attrs = st.get("attributes") or {}
        if attrs.get("hidden"):
            continue
        out.append({
            "id": eid,
            "domain": domain,
            "name": attrs.get("friendly_name") or eid,
            "state": None if domain in HA_RUN_ONLY else st.get("state"),
        })
    order = {d: i for i, d in enumerate(HA_DOMAINS)}
    out.sort(key=lambda e: (order[e["domain"]], e["name"].lower()))
    return out


def home_action(entity_id: str, action: str) -> dict:
    if not re.fullmatch(r"[a-z_]+\.[a-z0-9_]+", entity_id):
        raise ControlError(400, "Bad entity id")
    domain = entity_id.split(".", 1)[0]
    if domain not in HA_DOMAINS:
        raise ControlError(403, "That kind of thing can't be controlled from here")
    if action not in HA_ACTIONS:
        raise ControlError(400, "Unknown action")
    if domain in HA_RUN_ONLY:
        action = "turn_on"  # scenes and scripts just run
    service = "homeassistant" if domain in ("light", "switch", "fan", "input_boolean", "automation") else domain
    if domain == "media_player" and action == "toggle":
        action = "media_play_pause"
    _ha("POST", f"/api/services/{service}/{action}", {"entity_id": entity_id})
    st = _ha("GET", f"/api/states/{entity_id}") or {}
    return {"id": entity_id, "state": None if domain in HA_RUN_ONLY else st.get("state")}


# ---- Docker ----

def _docker(method: str, path: str):
    if not DOCKER_URL:
        raise ControlError(404, "Docker isn't set up on the server (DOCKER_URL)")
    return _call(method, DOCKER_URL + path, {}, None, timeout=40)


def docker_list() -> list:
    out = []
    for c in _docker("GET", "/containers/json?all=1") or []:
        names = [n.lstrip("/") for n in c.get("Names") or []]
        labels = c.get("Labels") or {}
        if any(n in PROTECT for n in names):
            continue
        out.append({
            "name": names[0] if names else c.get("Id", "")[:12],
            "image": c.get("Image", ""),
            "state": c.get("State", ""),
            "status": c.get("Status", ""),
            "project": labels.get("com.docker.compose.project", ""),
        })
    out.sort(key=lambda c: (c["state"] != "running", c["name"].lower()))
    return out


def docker_action(name: str, action: str) -> dict:
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]*", name):
        raise ControlError(400, "Bad container name")
    if action not in DOCKER_ACTIONS:
        raise ControlError(400, "Unknown action")
    # Docker also accepts IDs and ID prefixes, so check the real name rather than what was sent.
    name = ((_docker("GET", f"/containers/{name}/json") or {}).get("Name") or "").lstrip("/")
    if not name or name in PROTECT:
        raise ControlError(403, "That container can't be controlled from here")
    if action == "stop" and name in NO_STOP:
        raise ControlError(403, f"{name} runs Desk of Madness itself; restart it instead")
    _docker("POST", f"/containers/{name}/{action}")
    info = _docker("GET", f"/containers/{name}/json") or {}
    st = info.get("State") or {}
    return {"name": name, "state": st.get("Status", "")}
