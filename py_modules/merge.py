"""Two-way merge for one game's record. Shared by the Deck plugin and the server.

Rules:
- Notes, folders and counters merge by id; the copy with the newer updatedAt wins.
- Deletions are kept as tombstones in game["deleted"] = {id: deletedAtMs}; an item is
  dropped if it was deleted at or after its last edit.
- Sessions are only ever added, so they're a plain union.
- Totals (launches, playtime) take the max; the left-off pin takes the newer one.
- A game renamed on the website keeps that name (customName) over the one Steam reports.
"""

TOMBSTONE_TTL_MS = 180 * 24 * 3600 * 1000


def _stamp(item: dict) -> int:
    return item.get("updatedAt") or item.get("createdAt") or 0


def _carry_transcripts(winner: dict, other: dict) -> dict:
    """Voice-note transcripts are filled in by the server without touching updatedAt, so keep them
    whichever copy of the note wins."""
    known = {r.get("file"): r["transcript"] for r in other.get("recordings") or [] if r.get("transcript")}
    if not known or not any(r.get("file") in known and not r.get("transcript") for r in winner.get("recordings") or []):
        return winner
    recs = [{**r, "transcript": known[r["file"]]} if not r.get("transcript") and r.get("file") in known else r
            for r in winner["recordings"]]
    return {**winner, "recordings": recs}


def _merge_items(a: list, b: list, deleted: dict) -> list:
    out = {}
    for item in (a or []) + (b or []):
        if "id" not in item:
            continue
        cur = out.get(item["id"])
        if cur is None:
            out[item["id"]] = item
        elif _stamp(item) > _stamp(cur):
            out[item["id"]] = _carry_transcripts(item, cur)
        else:
            out[item["id"]] = _carry_transcripts(cur, item)
    return [i for i in out.values() if deleted.get(i["id"], -1) < _stamp(i)]


def merge_games(a: dict, b: dict, now_ms: int = 0) -> dict:
    deleted = dict(a.get("deleted") or {})
    for k, v in (b.get("deleted") or {}).items():
        deleted[k] = max(v, deleted.get(k, 0))
    if now_ms:
        deleted = {k: v for k, v in deleted.items() if now_ms - v < TOMBSTONE_TTL_MS}

    result = {**b, **a}  # scalar fields: start from either, fixed up below
    result["deleted"] = deleted
    for key in ("notes", "folders", "counters"):
        result[key] = _merge_items(a.get(key), b.get(key), deleted)
    sessions = {s["id"]: s for s in (b.get("sessions") or []) + (a.get("sessions") or []) if s.get("id")}
    for s in (a.get("sessions") or []) + (b.get("sessions") or []):
        if s.get("id") and s.get("end") and not sessions[s["id"]].get("end"):
            sessions[s["id"]] = s
    result["sessions"] = sorted(sessions.values(), key=lambda s: s.get("start") or 0)

    for key in ("launchCount", "playtimeSeconds"):
        result[key] = max(a.get(key) or 0, b.get(key) or 0)
    result["lastLaunched"] = max(a.get("lastLaunched") or 0, b.get("lastLaunched") or 0) or None
    firsts = [x for x in (a.get("firstSeen"), b.get("firstSeen")) if x]
    result["firstSeen"] = min(firsts) if firsts else None

    # A name set on the website (customName) beats the one Steam reports on every launch. customNameAt says
    # which side heard about the latest rename or reset, and that side's name wins.
    appid = str(result.get("appId"))
    ca, cb = a.get("customNameAt") or 0, b.get("customNameAt") or 0
    first, second = (b, a) if cb > ca else (a, b)
    custom = first.get("customName") if max(ca, cb) else None
    names = [n for n in (first.get("name"), second.get("name")) if n and n != appid]
    if custom:
        base = [n for n in names + [first.get("baseName"), second.get("baseName")] if n and n != custom]
        result["baseName"] = base[0] if base else None
        result["name"] = custom
    else:
        result.pop("baseName", None)
        result["name"] = names[0] if names else appid
    if max(ca, cb):
        result["customName"], result["customNameAt"] = custom or None, max(ca, cb)
    else:
        result.pop("customName", None), result.pop("customNameAt", None)

    la, lb = a.get("leftOff"), b.get("leftOff")
    result["leftOff"] = max((x for x in (la, lb) if x), key=lambda x: x.get("updatedAt", 0), default=None)
    result.pop("summary", None)
    return result


# ---------- references and sources across the Workshop (also shared by plugin and server) ----------

import uuid as _uuid


def refs_for_workshop(note: dict, find_note) -> list:
    """A note's references as a Workshop post can hold them: Workshop posts, plus your notes that are published
    there (others are private, so they're left out). `find_note(appid, note_id)` looks up one of your notes."""
    out = []
    for r in note.get("refs") or []:
        if r.get("workshopId"):
            out.append({"id": r["id"], "title": r.get("title") or "", "workshopId": r["workshopId"],
                        **({"appId": r["appId"]} if r.get("appId") else {})})
        elif r.get("noteId"):
            target = find_note(str(r.get("appId") or ""), r["noteId"])
            if target and target.get("bookstoreId"):
                out.append({"id": r["id"], "title": target.get("title") or r.get("title") or "", "workshopId": target["bookstoreId"],
                            "appId": r.get("appId")})
    return out


def links_from_workshop(entry: dict, notes: list) -> dict:
    """References and sources for a note copied from a Workshop post. A reference to a post you already copied
    into `notes` (that game's notes) points to your copy instead."""
    out = {}
    copies = {}
    for n in notes or []:
        for key in ((n.get("source") or {}).get("id"), n.get("bookstoreId")):
            if key:
                copies[key] = n
    refs = []
    for r in entry.get("refs") or []:
        if not r.get("workshopId"):
            continue
        mine = copies.get(r["workshopId"])
        if mine and str(r.get("appId") or entry.get("appId")) == str(entry.get("appId")):
            refs.append({"id": str(_uuid.uuid4()), "title": mine.get("title") or r.get("title") or "",
                         "appId": str(entry.get("appId")), "noteId": mine["id"]})
        else:
            refs.append({"id": str(_uuid.uuid4()), "title": r.get("title") or "", "workshopId": r["workshopId"],
                         **({"appId": r["appId"]} if r.get("appId") else {})})
    if refs:
        out["refs"] = refs
    sources = [{"id": str(_uuid.uuid4()), "title": s.get("title") or s["url"], "url": s["url"]}
               for s in entry.get("sources") or [] if s.get("url")]
    if sources:
        out["sources"] = sources
    return out


# ---------- per-note version history (also shared by plugin and server) ----------

import json as _json
import os as _os

NOTE_HISTORY_KEEP = 50


def _without_transcripts(note: dict) -> dict:
    if not any("transcript" in r for r in note.get("recordings") or []):
        return note
    return {**note, "recordings": [{k: v for k, v in r.items() if k != "transcript"} for r in note["recordings"]]}


def changed_notes(old_notes: list, new_notes: list):
    """Yield (old_version, reason) for every note that was edited or removed between two states.
    A transcript arriving for a voice note isn't an edit."""
    new_by_id = {n["id"]: n for n in new_notes or [] if "id" in n}
    for old in old_notes or []:
        new = new_by_id.get(old.get("id"))
        if new is None:
            yield old, "deleted"
        elif _stamp(new) != _stamp(old) or _without_transcripts(new) != _without_transcripts(old):
            yield old, "edited"


class NoteHistory:
    """Previous versions of notes, one JSON file per note: <base>/<appid>/<noteid>.json (newest last)."""

    def __init__(self, base_dir: str):
        self.base = base_dir

    def _path(self, appid: str, note_id: str) -> str:
        safe_id = "".join(c for c in str(note_id) if c.isalnum() or c in "-_")
        return _os.path.join(self.base, str(appid), f"{safe_id}.json")

    def get(self, appid: str, note_id: str) -> list:
        path = self._path(appid, note_id)
        if not _os.path.exists(path):
            return []
        with open(path) as f:
            return _json.load(f)

    def record(self, appid: str, old_notes: list, new_notes: list, now_ms: int):
        for old, reason in changed_notes(old_notes, new_notes):
            versions = self.get(appid, old["id"])
            if versions and versions[-1]["note"] == old:
                if reason == "deleted" and versions[-1]["reason"] != "deleted":
                    versions[-1]["reason"] = "deleted"
                    versions[-1]["savedAt"] = now_ms
                else:
                    continue
            else:
                versions.append({"savedAt": now_ms, "reason": reason, "note": old})
            path = self._path(appid, old["id"])
            _os.makedirs(_os.path.dirname(path), exist_ok=True)
            with open(path + ".tmp", "w") as f:
                _json.dump(versions[-NOTE_HISTORY_KEEP:], f)
            _os.replace(path + ".tmp", path)

    def deleted(self, appid: str, current_notes: list) -> list:
        """Notes whose last recorded event was a deletion and that aren't back in the game."""
        live = {n["id"] for n in current_notes or []}
        d = _os.path.join(self.base, str(appid))
        out = []
        for name in _os.listdir(d) if _os.path.isdir(d) else []:
            if not name.endswith(".json"):
                continue
            with open(_os.path.join(d, name)) as f:
                versions = _json.load(f)
            last = versions[-1] if versions else None
            if last and last["reason"] == "deleted" and last["note"]["id"] not in live:
                out.append({"deletedAt": last["savedAt"], "note": last["note"]})
        return sorted(out, key=lambda x: x["deletedAt"], reverse=True)
