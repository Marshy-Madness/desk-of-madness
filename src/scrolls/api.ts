import type * as React from "react";
import type { FC } from "react";
import type * as DFL from "@decky/ui";
import type { routerHook, toaster } from "@decky/api";
import type { TomeDef } from "../tomes/registry";
import type { Line, Buttons, Btn, Hint } from "../tomes/bits";
import type { MainMenuHook, QamTabsHook } from "./hooks";
import type { Game, Note, ReaderPage, SteamNewsItem, WikiChoice, WikiResult, WikiSite, WorkshopSummary } from "../types";

// What a code Scroll gets. A Scroll's code is a function `activate(desk)` (the default export of its
// index.tsx, see scrolls/README.md); it may return a cleanup. Everything it adds through `desk` is removed
// again when the Scroll is turned off, so Scrolls can be switched on and off without restarting.

export interface DeskScrollApi {
  scroll: { id: string; name: string; version: string };
  /** Steam's React, and Decky's UI library (the same ones the plugin uses). */
  React: typeof React;
  ui: typeof DFL;
  decky: { routerHook: typeof routerHook; toaster: typeof toaster };

  /** Adds a Tome to the Desk (the id is prefixed with the Scroll's, so it can't clash with built-in ones). */
  registerTome(def: Omit<TomeDef, "scroll" | "category"> & { category?: TomeDef["category"] }): void;
  /** The small building blocks the built-in Tomes use. */
  bits: { Line: typeof Line; Buttons: typeof Buttons; Btn: typeof Btn; Hint: typeof Hint };

  /** This Scroll's own settings, saved with Desk's settings (and synced with them). */
  settings: {
    get<T extends object>(): Partial<T>;
    set<T extends object>(patch: Partial<T>): Promise<void>;
    /** React hook: the settings, re-rendering when they change. */
    use<T extends object>(): Partial<T>;
  };
  /** A page for the Scroll's ⚙ Settings button in Scrolls. */
  setSettingsPage(page: FC<{ closeModal?: () => void }>): void;

  /** Quick Access tabs: change Steam's tab list as the menu draws. */
  onQamTabs(hook: QamTabsHook): void;
  qamTabsAvailable(): boolean;
  /** Main Steam menu: change its entries as it draws. */
  onMainMenu(hook: MainMenuHook): void;
  /** A full-screen page at `path` (removed when the Scroll stops). */
  addRoute(path: string, component: FC, exact?: boolean): void;
  /** Decky's route patch (e.g. "/library/app/:appid"), removed when the Scroll stops. */
  patchRoute(path: string, patch: (tree: any) => any): void;
  /** Shows one of Desk's pages or a Scroll's route, over the game if one is running. */
  showPage(path: string): void;
  /** Opens a web page in Desk's browser (reader view by default). */
  openUrl(url: string): void;

  /** Steam's news for a game, newest first. */
  steamNews(appId: string, count?: number): Promise<SteamNewsItem[]>;
  /** Madness Workshop posts (same filters as the Workshop tab: appId, sort, kind…). */
  workshopEntries(params: Record<string, string>): Promise<WorkshopSummary[]>;
  /** Shows a Workshop post in Desk's reader. */
  openWorkshopEntry(id: string, appId: string): void;
  /** Reader view pages: made and cached by the sync server (or on the Deck without one). Since 0.3.2-beta.2. */
  reader: {
    page(url: string, refresh?: boolean): Promise<ReaderPage>;
    /** A page's `html` as React elements; it's rebuilt from a whitelist, never handed to innerHTML. */
    elements(html: string): React.ReactNode;
    /** Styles for elements(), scoped to a `className="sn-reader"` box. */
    css: string;
  };
  /** MediaWiki sites (Fandom, wiki.gg, Wikipedia…), through the sync server. Read their pages with reader.page. Since 0.3.2-beta.2. */
  wiki: {
    /** Wikis for a game, best first. */
    find(gameName: string): Promise<WikiSite[]>;
    /** The wiki an address (or bare host name) is on; throws if it isn't one. */
    site(url: string): Promise<WikiSite>;
    search(wiki: string, q: string): Promise<WikiResult[]>;
    /** The wikis picked for each game, synced with the server and the website (first = the game's main wiki;
     * an empty list = none picked). `refresh` asks the server first. Since 0.4.0-beta.3. */
    picked?(refresh?: boolean): Promise<Record<string, WikiChoice>>;
    /** Sets a game's wikis, in order (first = main); [] forgets them. Since 0.4.0-beta.3. */
    pick?(appId: string, wikis: WikiSite[]): Promise<WikiChoice>;
  };
  /** The game being played, if any. Since 0.3.2-beta.2. */
  runningGame(): { appId: string; name: string } | null;
  useRunningGame(): { appId: string; name: string } | null;
  /** The person's notes. Since 0.3.2-beta.2. */
  notes: {
    game(appId: string): Promise<Game>;
    /** Saves a note (new or changed) and refreshes everything showing notes. */
    save(appId: string, note: Note): Promise<void>;
    /** Writes a new note; `gameName` adds the game to Desk first if it isn't there yet. */
    create(appId: string, gameName: string, fields: Partial<Note> & { title: string; body: string }): Promise<Note>;
    /** Shows a note in Desk's note viewer. */
    open(appId: string, noteId: string): Promise<void>;
  };
  /** For a full-screen page added with addRoute. Since 0.3.2-beta.2. */
  page: {
    /** Call in the page's component: it counts as one of Desk's pages (the combo puts it away) and the trackpads work as a mouse. */
    useDeskPage(): void;
    /** Steam's header and footer heights, to pad the page by. */
    useChromeHeights(): { header: number; footer: number };
    /** Puts the page away: back to the game, or wherever you were. */
    close(): void;
  };
  /** Asks for a line of text; null if cancelled. */
  askText(heading: string, label?: string, initial?: string): Promise<string | null>;

  /** Runs when the Scroll stops. */
  onUnload(fn: () => void): void;
  /** Turns the Scroll off (e.g. Steam or Decky changed and its hooks are gone), telling the person why. */
  disable(reason: string): void;
  log(...args: unknown[]): void;
}

export type ScrollActivate = (desk: DeskScrollApi) => void | (() => void) | Promise<void | (() => void)>;
