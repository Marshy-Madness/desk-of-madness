import { useSyncExternalStore } from "react";
import { getSettings, updateSettings } from "../state/notesStore";
import { DeskPage, DeskSettings } from "../types";

// The Desk's pages. Each holds its own Tomes; the game page is the one that follows the game and keeps the
// per-game layouts. Pages can be added, renamed, reordered and deleted (all but the game page).

export const GAME_PAGE = "game";

export const PLAY_TOMES = ["last-session", "games-today", "today-time", "streak", "week-time", "most-played", "records", "activity"];
export const TROPHY_TOMES = ["ach-percent", "perfect-games", "unlock-totals", "rarest", "game-achievements", "recent-unlocks", "almost-perfect"];

const strict = (order: string[]) => ({ order, hidden: [], collapsed: [], strict: true });

export const STARTER_PAGES: DeskPage[] = [
  { id: "today", name: "Today", icon: "📅", layout: strict(PLAY_TOMES) },
  { id: GAME_PAGE, name: "Game", icon: "🎮" },
  { id: "trophies", name: "Trophies", icon: "🏆", layout: strict(TROPHY_TOMES) },
];

export const PAGE_ICONS = ["📅", "🎮", "🏆", "📊", "📝", "⭐", "🧭", "🗂️", "⚔️", "🎯", "🔥", "🌙"];

/** The pages in order. There's always a game page. */
export function pagesOf(d: DeskSettings = getSettings().desk ?? {}): DeskPage[] {
  const pages = d.pages?.length ? d.pages : STARTER_PAGES;
  return pages.some((p) => p.id === GAME_PAGE) ? pages : [...pages, STARTER_PAGES[1]];
}

const save = (pages: DeskPage[]) => {
  const d = getSettings().desk ?? {};
  return updateSettings({ desk: { ...d, pages } });
};

export const savePage = (id: string, patch: Partial<DeskPage>) => save(pagesOf().map((p) => (p.id === id ? { ...p, ...patch } : p)));

export function addPage(name: string, icon: string): string {
  const id = `p${Date.now().toString(36)}`;
  save([...pagesOf(), { id, name, icon, layout: strict([]) }]);
  return id;
}

export function deletePage(id: string) {
  if (id === GAME_PAGE) return;
  if (current === id) setCurrentPage(GAME_PAGE);
  return save(pagesOf().filter((p) => p.id !== id));
}

export function movePage(id: string, by: -1 | 1) {
  const pages = [...pagesOf()];
  const i = pages.findIndex((p) => p.id === id);
  const j = i + by;
  if (i < 0 || j < 0 || j >= pages.length) return;
  [pages[i], pages[j]] = [pages[j], pages[i]];
  return save(pages);
}

export const resetPages = () => {
  const d = getSettings().desk ?? {};
  const { pages: _drop, ...rest } = d;
  return updateSettings({ desk: rest });
};

// ---------- the page showing ----------

let current: string | null = null;
const listeners = new Set<() => void>();

export function setCurrentPage(id: string) {
  current = id;
  listeners.forEach((l) => l());
}

/** The page showing; the first time, the game page while a game runs, else the first page. */
export function currentPage(running: boolean): string {
  const pages = pagesOf();
  if (!current || !pages.some((p) => p.id === current)) current = running ? GAME_PAGE : pages[0].id;
  return current;
}

/** Steps to the next (+1) or previous (-1) page, wrapping around. */
export function stepPage(by: -1 | 1, running: boolean) {
  const pages = pagesOf();
  const i = pages.findIndex((p) => p.id === currentPage(running));
  setCurrentPage(pages[(i + by + pages.length) % pages.length].id);
}

export function useCurrentPage(running: boolean): string {
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current
  );
  return currentPage(running);
}
