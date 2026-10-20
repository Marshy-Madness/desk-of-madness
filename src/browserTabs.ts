import { useSyncExternalStore } from "react";
import { BrowserMode } from "./types";
import { newId } from "./utils/format";

// The browser's tabs. They live here rather than in the page, so they're still there after you put the browser
// away (for example going back to Steam's store to pick another game, which opens in a tab of its own).

export type Entry = { url: string; mode: BrowserMode };

export interface BrowserTab {
  id: string;
  cur: Entry;
  /** This tab's own Back and Forward (the full-page view also keeps its own while it's open). */
  back: Entry[];
  forward: Entry[];
  title: string;
}

const MAX_TABS = 12; // past this, the oldest tab that isn't showing closes

let tabs: BrowserTab[] = [];
let activeId: string | null = null;
let version = 0;
const listeners = new Set<() => void>();

function changed() {
  version++;
  listeners.forEach((l) => l());
}

export const getTabs = (): readonly BrowserTab[] => tabs;
export const activeTab = (): BrowserTab | null => tabs.find((t) => t.id === activeId) ?? null;

/** Re-renders on any change to the tabs (opened, closed, switched, retitled). */
export function useTabsVersion(): number {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => version
  );
}

export function addTab(entry: Entry): BrowserTab {
  const tab: BrowserTab = { id: newId(), cur: entry, back: [], forward: [], title: "" };
  tabs = [...tabs, tab];
  activeId = tab.id;
  while (tabs.length > MAX_TABS) tabs = tabs.filter((t) => t !== tabs.find((o) => o.id !== activeId));
  changed();
  return tab;
}

export function switchTab(id: string) {
  if (id === activeId || !tabs.some((t) => t.id === id)) return;
  activeId = id;
  changed();
}

/** Closes a tab; the one next to it shows. Returns false if it was the last one. */
export function closeTab(id: string): boolean {
  const i = tabs.findIndex((t) => t.id === id);
  if (i < 0) return tabs.length > 0;
  tabs = tabs.filter((t) => t.id !== id);
  if (activeId === id) activeId = tabs[Math.min(i, tabs.length - 1)]?.id ?? null;
  changed();
  return tabs.length > 0;
}

export function closeOtherTabs(id: string) {
  tabs = tabs.filter((t) => t.id === id);
  activeId = tabs[0]?.id ?? null;
  changed();
}

/** Keeps a tab's page and title current, for the tab strip and for coming back to it later. */
export function updateTab(id: string, patch: Partial<Pick<BrowserTab, "cur" | "title">>) {
  const tab = tabs.find((t) => t.id === id);
  if (!tab) return;
  const titleChanged = patch.title !== undefined && patch.title !== tab.title;
  const curChanged = !!patch.cur && (patch.cur.url !== tab.cur.url || patch.cur.mode !== tab.cur.mode);
  Object.assign(tab, patch);
  if (titleChanged || curChanged) changed();
}

/** The tab next to the showing one (step 1 = right, -1 = left), wrapping round. */
export function neighbourTab(step: 1 | -1): BrowserTab | null {
  const i = tabs.findIndex((t) => t.id === activeId);
  if (i < 0 || tabs.length < 2) return null;
  return tabs[(i + step + tabs.length) % tabs.length];
}
