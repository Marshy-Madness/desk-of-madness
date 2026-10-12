import { getSettings, updateSettings, useSettings } from "../state/notesStore";
import { DeskLayout, DeskSettings, TomeSize } from "../types";
import { allTomes, TomeDef, useTomes } from "./registry";
import { getServerInfo, useServerInfo } from "../state/speech";
import { GAME_PAGE, pagesOf, savePage } from "./pages";

// Which Tomes the Desk shows and in what order. The Desk has pages (pages.ts). The game page has one layout
// for every game, and (unless per-game layouts are turned off) a game gets its own the first time you change
// the Desk while it's showing. Every other page has a single layout of its own.

export const DEFAULT_ORDER = [
  "game-brain",
  "quick-actions",
  "left-off",
  "checklist",
  "counters",
  "recent-notes",
  "guides",
  "voice-notes",
  "screenshot",
  "game-stats",
  "workshop",
  "pinned-notes",
  "shared-notes",
  "system",
  "storage",
  "network",
];

/** Where a layout lives: a page, and (for the game page) the game showing. */
export interface DeskAt {
  pageId: string;
  appId: string | null;
}

const desk = (): DeskSettings => getSettings().desk ?? {};

export const perGameOn = (d: DeskSettings = desk()) => d.perGame !== false;

/** The default layout knows no Tomes, so each one shows in the built-in order, on if it's on by default. */
export const defaultLayout = (): DeskLayout => ({ order: [], hidden: [], collapsed: [] });

/** The layout to use for a page (and, on the game page, a game; null = no game showing). */
export function layoutFor(at: DeskAt, d: DeskSettings = desk()): DeskLayout {
  if (at.pageId !== GAME_PAGE) {
    const page = pagesOf(d).find((p) => p.id === at.pageId);
    if (page?.layout) return page.layout;
  }
  const appId = at.appId;
  // Then the starting Desk the sync server's admin set, then the built-in one.
  return (appId && perGameOn(d) && d.games?.[appId]) || d.layout || getServerInfo().deskDefaults || defaultLayout();
}

/** True when this game has a layout of its own (game page only). */
export const hasOwnLayout = (at: DeskAt, d: DeskSettings = desk()) =>
  at.pageId === GAME_PAGE && !!(at.appId && perGameOn(d) && d.games?.[at.appId]);

export interface Arranged {
  def: TomeDef;
  on: boolean;
  collapsed: boolean;
  size: TomeSize;
}

/** Every known Tome in display order, with whether it's on, folded, and its size. */
export function arrange(layout: DeskLayout, tomes: readonly TomeDef[], sizes: Record<string, TomeSize> = {}): Arranged[] {
  const ids = tomes.map((t) => t.id);
  const order = [
    ...layout.order.filter((id) => ids.includes(id)),
    // Tomes the layout doesn't know yet (newly added or from a Scroll): in default order at the end.
    ...ids.filter((id) => !layout.order.includes(id)).sort((a, b) => rank(a) - rank(b)),
  ];
  return order.map((id) => {
    const def = tomes.find((t) => t.id === id)!;
    const known = layout.order.includes(id);
    return {
      def,
      on: !layout.hidden.includes(id) && (known || (!layout.strict && def.defaultOn)),
      collapsed: layout.collapsed.includes(id),
      size: sizeOf(def, layout.sizes?.[id] ?? sizes[id]),
    };
  });
}

/** A Tome's size: what was picked if it can be drawn that way, else its own default. */
export function sizeOf(def: TomeDef, picked?: TomeSize): TomeSize {
  const can = def.sizes ?? ["card"];
  if (picked && can.includes(picked)) return picked;
  return def.defaultSize ?? can[0];
}

const rank = (id: string) => {
  const i = DEFAULT_ORDER.indexOf(id);
  return i < 0 ? DEFAULT_ORDER.length : i;
};

/** Saves a change to a layout: a page's own, or on the game page the game's own when per-game layouts are on. */
export function changeLayout(at: DeskAt, change: (l: DeskLayout) => DeskLayout) {
  const d = desk();
  const current = layoutFor(at, d);
  // Fold in Tomes the saved layout didn't know about, so they keep their place once it's saved.
  const full = arrange(current, allTomes());
  const base: DeskLayout = {
    order: full.map((x) => x.def.id),
    hidden: full.filter((x) => !x.on).map((x) => x.def.id),
    collapsed: full.filter((x) => x.collapsed).map((x) => x.def.id),
    ...(current.sizes ? { sizes: current.sizes } : {}),
    ...(current.strict ? { strict: true } : {}),
  };
  const next = change(base);
  if (at.pageId !== GAME_PAGE) return savePage(at.pageId, { layout: next });
  if (at.appId && perGameOn(d)) return updateSettings({ desk: { ...d, games: { ...d.games, [at.appId]: next } } });
  return updateSettings({ desk: { ...d, layout: next } });
}

const without = (list: string[], id: string) => list.filter((x) => x !== id);

export const setTomeOn = (at: DeskAt, id: string, on: boolean) =>
  changeLayout(at, (l) => {
    const hidden = on ? without(l.hidden, id) : [...without(l.hidden, id), id];
    return { ...l, hidden };
  });

export const setCollapsed = (at: DeskAt, id: string, collapsed: boolean) =>
  changeLayout(at, (l) => ({ ...l, collapsed: collapsed ? [...without(l.collapsed, id), id] : without(l.collapsed, id) }));

export const setTomeSize = (at: DeskAt, id: string, size: TomeSize) =>
  changeLayout(at, (l) => ({ ...l, sizes: { ...l.sizes, [id]: size } }));

/** Moves a Tome up (-1) or down (+1) among the Tomes that are on. */
export const moveTome = (at: DeskAt, id: string, by: -1 | 1) =>
  changeLayout(at, (l) => {
    const visible = l.order.filter((x) => !l.hidden.includes(x));
    const i = visible.indexOf(id);
    const target = visible[i + by];
    if (i < 0 || !target) return l;
    const order = [...l.order];
    const a = order.indexOf(id);
    const b = order.indexOf(target);
    [order[a], order[b]] = [order[b], order[a]];
    return { ...l, order };
  });

/** Makes this game's layout the one every game uses (and drops the game's own copy). */
export function useForAllGames(appId: string) {
  const d = desk();
  const own = d.games?.[appId];
  if (!own) return;
  const games = { ...d.games };
  delete games[appId];
  return updateSettings({ desk: { ...d, layout: own, games } });
}

/** Back to the layout every game uses. */
export function resetGameLayout(appId: string) {
  const d = desk();
  const games = { ...d.games };
  delete games[appId];
  return updateSettings({ desk: { ...d, games } });
}

/** The arranged Tomes for a page (and game), re-rendering when settings or the registered Tomes change. */
export function useArrangement(at: DeskAt) {
  const settings = useSettings();
  const tomes = useTomes();
  useServerInfo(); // the admin's starting Desk can arrive after the first draw
  const d = settings.desk ?? {};
  return {
    items: arrange(layoutFor(at, d), tomes, d.sizes),
    own: hasOwnLayout(at, d),
    perGame: at.pageId === GAME_PAGE && perGameOn(d),
  };
}
