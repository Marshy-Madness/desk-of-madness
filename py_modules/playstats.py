"""Play statistics from the sessions every game records. Stdlib only; shared by the plugin and the sync server.

A session counts toward the day it started on, and a day starts at `day_start_hour` local time (4 AM by
default, so late nights count toward the evening before). The caller passes its timezone offset the way
JavaScript's Date.getTimezoneOffset() gives it (minutes behind UTC), so the Deck and the website agree on
what "today" is.
"""
import time

DAY = 86400
# Steam gives shortcuts (non-Steam games) app IDs with the top bit set.
NON_STEAM_MIN = 0x80000000


def is_non_steam(appid) -> bool:
    try:
        return int(appid) >= NON_STEAM_MIN
    except (TypeError, ValueError):
        return True


def _day_index(ms: int, offset_s: int) -> int:
    """Days since the epoch in the caller's local time, with the day starting at the day-start hour."""
    return int((ms // 1000 - offset_s) // DAY)


def _day_label(index: int) -> str:
    return time.strftime("%Y-%m-%d", time.gmtime(index * DAY))


def collect(games, now_ms: int, running_app_id=None, include_non_steam=True, min_seconds=300):
    """Every counted session as (appId, name, start_ms, seconds, live), oldest first."""
    out = []
    for g in games:
        appid = str(g.get("appId"))
        if not include_non_steam and is_non_steam(appid):
            continue
        name = g.get("name") or appid
        sessions = sorted((s for s in g.get("sessions") or [] if s.get("start")), key=lambda s: s["start"])
        for i, s in enumerate(sessions):
            end, live = s.get("end"), False
            if end is None:
                # Only the game running now has a real open session; older open ones were left by a crash.
                if appid != str(running_app_id) or i != len(sessions) - 1:
                    continue
                end, live = now_ms, True
            seconds = max(0, (end - s["start"]) // 1000)
            if seconds < min_seconds and not live:
                continue
            out.append((appid, name, s["start"], seconds, live))
    out.sort(key=lambda x: x[2])
    return out


def _top(totals: dict, names: dict, n=3):
    best = sorted(totals.items(), key=lambda kv: -kv[1])[:n]
    return [{"appId": a, "name": names[a], "seconds": int(sec)} for a, sec in best if sec > 0]


def stats(games, now_ms=None, tz_offset_min=0, day_start_hour=4, min_seconds=300, include_non_steam=True,
          running_app_id=None, calendar_days=112):
    """Everything the session Tomes show, in one answer."""
    now_ms = now_ms or int(time.time() * 1000)
    offset_s = int(tz_offset_min) * 60 + int(day_start_hour) * 3600
    sessions = collect(games, now_ms, running_app_id, include_non_steam, min_seconds)
    today = _day_index(now_ms, offset_s)

    per_day = {}
    names = {}
    week, month, ever = {}, {}, {}
    today_ids = []
    for appid, name, start, seconds, _live in sessions:
        names[appid] = name
        d = _day_index(start, offset_s)
        per_day[d] = per_day.get(d, 0) + seconds
        ever[appid] = ever.get(appid, 0) + seconds
        if today - d < 7:
            week[appid] = week.get(appid, 0) + seconds
        if today - d < 30:
            month[appid] = month.get(appid, 0) + seconds
        if d == today and appid not in today_ids:
            today_ids.append(appid)

    # Streaks: days in a row with play. Today not played yet doesn't break the streak.
    played = sorted(per_day)
    best = run = 0
    prev = None
    for d in played:
        run = run + 1 if prev is not None and d == prev + 1 else 1
        best = max(best, run)
        prev = d
    current = 0
    d = today if today in per_day else today - 1
    while d in per_day:
        current += 1
        d -= 1

    last = sessions[-1] if sessions else None
    longest = max(sessions, key=lambda x: x[3]) if sessions else None
    total = sum(x[3] for x in sessions)
    # When tracking started, so widgets can say "since <date>".
    first = sessions[0][2] if sessions else None

    return {
        "now": now_ms,
        "dayStartHour": day_start_hour,
        "trackedSince": first,
        "last": last and {"appId": last[0], "name": last[1], "start": last[2], "seconds": int(last[3]), "live": last[4]},
        "today": {
            "seconds": int(per_day.get(today, 0)),
            "games": [{"appId": a, "name": names[a]} for a in today_ids],
        },
        "week": {
            "seconds": int(sum(per_day.get(today - i, 0) for i in range(7))),
            "days": [{"day": _day_label(today - i), "seconds": int(per_day.get(today - i, 0))} for i in range(6, -1, -1)],
        },
        "streak": {"current": current, "best": best, "playedToday": today in per_day},
        "records": {
            "longest": longest and {"appId": longest[0], "name": longest[1], "start": longest[2], "seconds": int(longest[3])},
            "averageSeconds": int(total / len(sessions)) if sessions else 0,
            "sessions": len(sessions),
            "totalSeconds": int(total),
        },
        "mostPlayed": {"week": _top(week, names), "month": _top(month, names), "allTime": _top(ever, names)},
        "calendar": [{"day": _day_label(today - i), "seconds": int(per_day.get(today - i, 0))}
                     for i in range(calendar_days - 1, -1, -1)],
    }
