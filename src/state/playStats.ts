import { useEffect, useSyncExternalStore } from "react";
import { backend } from "../api/backend";
import { getRunningGame, useRunningGame } from "../hooks/useAppLifetime";
import { PlayGameTime, PlaySettings, PlayStats } from "../types";
import { getSettings, useDataVersion, useSettings } from "./notesStore";

// The session Tomes all read one PlayStats (py_modules/playstats.py), fetched once and shared. It's fetched
// again when games change (a launch, an exit, a sync) and every minute while a game runs, so live numbers move.

let stats: PlayStats | null = null;
let error: string | null = null;
let loading: Promise<void> | null = null;
let fetchedAt = 0;
let users = 0;
let timer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export const playOptions = (): Required<PlaySettings> => {
  const p = getSettings().play ?? {};
  return { includeNonSteam: p.includeNonSteam !== false, dayStartHour: p.dayStartHour ?? 4, minMinutes: p.minMinutes ?? 5 };
};

export function refreshPlayStats(): Promise<void> {
  if (loading) return loading;
  loading = backend
    .playStats(new Date().getTimezoneOffset(), getRunningGame()?.appId ?? "", playOptions())
    .then(
      (s) => {
        stats = { ...s, mostPlayed: { ...s.mostPlayed, allTime: steamAllTime() ?? s.mostPlayed.allTime } };
        error = null;
      },
      (e) => {
        console.error("Desk of Madness: play_stats failed", e);
        error = String(e?.message ?? e);
      }
    )
    .finally(() => {
      loading = null;
      fetchedAt = Date.now();
      notify();
    });
  return loading;
}

/** Steam's own lifetime playtime, which goes back further than the sessions Desk of Madness tracked. */
export function steamAllTime(n = 3): PlayGameTime[] | null {
  const apps: Map<number, any> | undefined = (window as any).appStore?.m_mapApps;
  if (!apps) return null;
  const includeShortcuts = playOptions().includeNonSteam;
  const games = Array.from(apps.values()).filter(
    (a) => a && a.minutes_playtime_forever > 0 && (a.app_type === 1 || (includeShortcuts && a.app_type === 1073741824))
  );
  if (!games.length) return null;
  return games
    .sort((a, b) => b.minutes_playtime_forever - a.minutes_playtime_forever)
    .slice(0, n)
    .map((a) => ({ appId: String(a.appid), name: a.display_name, seconds: a.minutes_playtime_forever * 60 }));
}

/** The shared play statistics; null until the first answer. */
export function usePlayStats(): { stats: PlayStats | null; error: string | null } {
  const version = useDataVersion();
  const running = useRunningGame();
  const options = JSON.stringify(useSettings().play ?? {});
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => fetchedAt
  );
  useEffect(() => {
    refreshPlayStats();
  }, [version, running?.appId, options]);
  useEffect(() => {
    if (!running) return;
    // One timer however many Tomes are showing.
    if (users++ === 0) timer = setInterval(refreshPlayStats, 60_000);
    return () => {
      if (--users === 0) clearInterval(timer);
    };
  }, [running?.appId]);
  return { stats, error };
}
