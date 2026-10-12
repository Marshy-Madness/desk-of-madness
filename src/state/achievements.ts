import { useEffect, useSyncExternalStore } from "react";
import { backend } from "../api/backend";
import { Achievement, AchievementData, GameAchievements } from "../types";

// Steam achievements, read from the Steam client itself (no key, works offline):
//  - window.appAchievementProgressCache: unlocked / total for every game in the library. Asking it about a game
//    queues a refresh from Steam, so we ask about every owned game and read the answers a moment later.
//  - SteamClient.Apps.GetMyAchievementsForApp: the full list for one game (names, icons, unlock times, the
//    global unlock %), fetched for recently played games and whichever game you open.
// The result is saved by the backend (achievements.json) and synced to the server for the website.

let data: AchievementData = { updatedAt: 0, games: {} };
let loaded = false;
let busy: Promise<void> | null = null;
let version = 0;
const listeners = new Set<() => void>();
const changed = () => {
  version++;
  listeners.forEach((l) => l());
};

const SECOND = 1000;
const LIBRARY_EVERY = 30 * 60 * SECOND;
const LIST_EVERY = 10 * 60 * SECOND;
const ICON_BASE = "https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps";

const apps = (): any[] => Array.from(((window as any).appStore?.m_mapApps as Map<number, any> | undefined)?.values() ?? []);
const overview = (appId: string) => (window as any).appStore?.GetAppOverviewByAppID?.(Number(appId));

async function load() {
  if (loaded) return;
  loaded = true;
  try {
    const saved = await backend.getAchievements();
    if (saved?.games) data = saved;
    changed();
  } catch (e) {
    console.error("Desk of Madness: get_achievements failed", e);
  }
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
function save() {
  data = { ...data, updatedAt: Date.now() };
  changed();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => backend.saveAchievements(data).catch((e) => console.error("Desk of Madness: save_achievements failed", e)), 2000);
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Unlocked / total for every game in the library. */
export function refreshLibrary(force = false): Promise<void> {
  if (busy) return busy;
  if (!force && Date.now() - (libraryAt || 0) < LIBRARY_EVERY && Object.keys(data.games).length) return Promise.resolve();
  busy = (async () => {
    await load();
    const cache = (window as any).appAchievementProgressCache;
    if (!cache) return;
    const games = apps().filter((a) => a && a.app_type === 1 && a.visible_in_game_list);
    for (const a of games) cache.GetAchievementProgress?.(a.appid); // queues the ones Steam doesn't have yet
    await wait(4 * SECOND);
    const map: Map<number, any> | undefined = cache.m_achievementProgress?.mapCache;
    if (!map) return;
    const now = Date.now();
    const next = { ...data.games };
    for (const a of games) {
      const p = map.get(a.appid);
      if (!p || !p.total) continue;
      const id = String(a.appid);
      const old = next[id];
      next[id] = {
        ...old,
        appId: id,
        name: a.display_name,
        unlocked: p.unlocked,
        total: p.total,
        playtimeMin: a.minutes_playtime_forever || 0,
        lastPlayed: a.rt_last_time_played || 0,
        updatedAt: now,
      };
    }
    data = { ...data, games: next };
    libraryAt = now;
    save();
    // The full lists for the games played most recently.
    const recent = Object.values(next)
      .filter((g) => g.lastPlayed)
      .sort((x, y) => (y.lastPlayed ?? 0) - (x.lastPlayed ?? 0))
      .slice(0, 12);
    for (const g of recent) await refreshGame(g.appId);
  })().finally(() => (busy = null));
  return busy;
}
let libraryAt = 0;

const listAt: Record<string, number> = {};

/** The full achievement list for one game. */
export async function refreshGame(appId: string, force = false): Promise<GameAchievements | null> {
  await load();
  if (!force && Date.now() - (listAt[appId] || 0) < LIST_EVERY && data.games[appId]?.list) return data.games[appId];
  listAt[appId] = Date.now();
  let res: any;
  try {
    res = await (window as any).SteamClient?.Apps?.GetMyAchievementsForApp?.(String(appId));
  } catch (e) {
    console.warn("Desk of Madness: GetMyAchievementsForApp failed", appId, e);
    return data.games[appId] ?? null;
  }
  const rg: any[] = res?.result === 1 ? res.data?.rgAchievements ?? [] : [];
  if (!rg.length) return data.games[appId] ?? null;
  const list: Achievement[] = rg.map((a) => ({
    id: a.strID,
    name: a.strName ?? a.strID,
    description: a.strDescription ?? "",
    icon: iconUrl(appId, a.strImage),
    hidden: !!a.bHidden,
    unlockedAt: a.bAchieved ? a.rtUnlocked || 1 : 0,
    globalPct: typeof a.flAchieved === "number" ? a.flAchieved : undefined,
    progress: a.flMaxProgress > 1 ? { current: Math.min(a.flCurrentProgress ?? 0, a.flMaxProgress), max: a.flMaxProgress } : undefined,
  }));
  const ov = overview(appId);
  const old = data.games[appId];
  data = {
    ...data,
    games: {
      ...data.games,
      [appId]: {
        ...old,
        appId,
        name: ov?.display_name ?? old?.name ?? appId,
        unlocked: list.filter((a) => a.unlockedAt).length,
        total: list.length,
        playtimeMin: ov?.minutes_playtime_forever ?? old?.playtimeMin,
        lastPlayed: ov?.rt_last_time_played ?? old?.lastPlayed,
        list,
        updatedAt: Date.now(),
      },
    },
  };
  save();
  return data.games[appId];
}

function iconUrl(appId: string, img?: string) {
  if (!img) return "";
  if (/^https?:/.test(img)) return img;
  return `${ICON_BASE}/${appId}/${img}${img.includes(".") ? "" : ".jpg"}`;
}

/** Steam tells us when an achievement unlocks; refresh that game's list. */
export function startAchievementWatch(): () => void {
  const reg = (window as any).SteamClient?.GameSessions?.RegisterForAchievementNotification?.((n: { unAppID: number }) => {
    if (n?.unAppID) setTimeout(() => refreshGame(String(n.unAppID), true), 3000);
  });
  // A first pass a little after start, so it doesn't slow Steam down while it loads.
  const t = setTimeout(() => refreshLibrary(), 20 * SECOND);
  return () => {
    clearTimeout(t);
    reg?.unregister?.();
  };
}

export const getAchievements = () => data;

export function useAchievements(): AchievementData {
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => version
  );
  useEffect(() => {
    load().then(() => refreshLibrary());
  }, []);
  return data;
}

/** One game's achievements, fetching its full list when it's shown. */
export function useGameAchievements(appId: string | null | undefined): GameAchievements | null {
  const all = useAchievements();
  useEffect(() => {
    if (appId) refreshGame(appId);
  }, [appId]);
  return appId ? all.games[appId] ?? null : null;
}

// ---------- numbers the Tomes share ----------

export interface AchievementSummary {
  /** Games with achievements. */
  games: GameAchievements[];
  started: GameAchievements[];
  perfect: GameAchievements[];
  /** Average % over started games, and over every game with achievements. */
  avgStarted: number;
  avgAll: number;
  unlocked: number;
  total: number;
  /** Started, not perfect, fewest left first. */
  almost: GameAchievements[];
  /** Unlocks from the full lists, newest first. */
  recent: { game: GameAchievements; a: Achievement }[];
  rarest: { game: GameAchievements; a: Achievement } | null;
  unlockedThisWeek: number;
}

const pct = (g: GameAchievements) => (g.total ? g.unlocked / g.total : 0);

export function summarize(d: AchievementData): AchievementSummary {
  const games = Object.values(d.games).filter((g) => g.total > 0);
  const started = games.filter((g) => g.unlocked > 0);
  const perfect = games.filter((g) => g.unlocked >= g.total);
  const avg = (list: GameAchievements[]) => (list.length ? (list.reduce((n, g) => n + pct(g), 0) / list.length) * 100 : 0);
  const recent = games
    .flatMap((game) => (game.list ?? []).filter((a) => a.unlockedAt > 1).map((a) => ({ game, a })))
    .sort((x, y) => y.a.unlockedAt - x.a.unlockedAt);
  const rarest =
    recent.filter((x) => x.a.globalPct != null).sort((x, y) => (x.a.globalPct ?? 100) - (y.a.globalPct ?? 100))[0] ?? null;
  const weekAgo = Date.now() / 1000 - 7 * 86400;
  return {
    games,
    started,
    perfect,
    avgStarted: avg(started),
    avgAll: avg(games),
    unlocked: games.reduce((n, g) => n + g.unlocked, 0),
    total: games.reduce((n, g) => n + g.total, 0),
    almost: started.filter((g) => g.unlocked < g.total).sort((x, y) => x.total - x.unlocked - (y.total - y.unlocked) || pct(y) - pct(x)),
    recent,
    rarest,
    unlockedThisWeek: recent.filter((x) => x.a.unlockedAt >= weekAgo).length,
  };
}
