export interface Screenshot {
  id: string;
  file: string;
  thumb?: string;
  takenAt: number;
}

export interface Recording {
  id: string;
  file: string;
  createdAt: number;
  durationSec?: number;
  /** What was said, written out by the sync server's speech to text. */
  transcript?: string;
}

export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
}

/** A grid of cells kept next to the note's information. Row 0 of `rows` is not special; `columns` are the headings. */
export interface NoteTable {
  id: string;
  title: string;
  columns: string[];
  rows: string[][];
  /** Shown open when reading the note; otherwise it's a line you open. */
  showInView?: boolean;
}

/** A pointer from a note to another of your notes (any game) or to a Madness Workshop post. */
export interface NoteRef {
  id: string;
  /** The target's title when the link was made, shown if it can't be found any more. */
  title: string;
  appId?: string;
  noteId?: string;
  /** Set instead of noteId for a Workshop post. */
  workshopId?: string;
}

/** A web page a note got its information from. */
export interface NoteSource {
  id: string;
  title: string;
  url: string;
}

export type PadScroll = "circle" | "swipe";

export type NoteKind =
  | "note"
  | "guide"
  | "tip"
  | "walkthrough"
  | "boss"
  | "build"
  | "collectibles"
  | "secret"
  | "settings"
  | "achievement";

export interface Note {
  id: string;
  folderId: string | null;
  title: string;
  body: string;
  tags: string[];
  screenshots: Screenshot[];
  recordings: Recording[];
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
  /** Which launch of the game this note was written during. */
  launchNumber: number | null;
  checklist?: ChecklistItem[];
  tables?: NoteTable[];
  /** Guides and notes this one points to. */
  refs?: NoteRef[];
  /** Web pages this note's information came from. */
  sources?: NoteSource[];
  /** Hidden behind a "reveal" until you choose to look. */
  spoiler?: boolean;
  /** What sort of note this is; "note" when missing. Guides also show in the virtual Guides folder. */
  kind?: NoteKind;
  /** Set when the note was copied from the Workshop or a shared note. */
  source?: { type: "bookstore" | "shared"; id: string; author: string };
  /** Workshop entry this note was published as. */
  bookstoreId?: string;
}

export type CounterKind = "death" | "boss" | "custom";

export interface Counter {
  id: string;
  name: string;
  kind: CounterKind;
  count: number;
  sessionCount: number;
  defeated?: boolean;
  createdAt: number;
  updatedAt?: number;
}

export interface LeftOff {
  text: string;
  updatedAt: number;
  launchNumber: number | null;
}

export interface NoteVersion {
  savedAt: number;
  reason: "edited" | "deleted";
  note: Note;
}

export interface DeletedNote {
  deletedAt: number;
  note: Note;
}

export interface Folder {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: number;
}

export interface Session {
  id: string;
  start: number;
  end: number | null;
}

/** A note another user on your sync server shared with you (read-only). */
export interface SharedNote {
  shareId: string;
  fromId: string;
  fromName: string;
  note: Note;
}

export interface GameSummary {
  appId: string;
  name: string;
  launchCount: number;
  lastLaunched: number | null;
  firstSeen: number | null;
  playtimeSeconds: number;
  noteCount: number;
  folderCount: number;
  lastEdited: number | null;
  firstNoteCreated: number | null;
  leftOff: LeftOff | null;
  /** Notes other users shared with you for this game. */
  sharedCount?: number;
}

export interface ServerUser {
  id: string;
  name: string;
  avatar: string;
  steamId: string | null;
}

export interface Share {
  id: string;
  to: string;
  toName: string;
  noteId: string;
}

export interface Game {
  appId: string;
  name: string;
  launchCount: number;
  lastLaunched: number | null;
  playtimeSeconds: number;
  folders: Folder[];
  notes: Note[];
  sessions: Session[];
  counters?: Counter[];
  leftOff?: LeftOff | null;
  /** Notes shared with you, cached from the sync server. */
  shared?: SharedNote[];
  summary: GameSummary;
}

export interface SteamScreenshot {
  path: string;
  takenAt: number;
  preview: string;
}

export type SortMode = "alpha" | "created" | "edited" | "recent";
/** @deprecated the old fixed choices for the open combo; see Settings.combos */
export type OpenChord = "l4r4" | "l5r5" | "l3r3" | "off";
/**
 * What a button combo does: the radial menu, Desk Commands (the command palette), open the notes page ("open"), the Desk, the web browser, speech
 * to text or a voice command. "tomes" is the old name of the radial combo, still read as its fallback.
 */
export type ComboAction = "radial" | "commands" | "open" | "quicknote" | "desk" | "web" | "achievements" | "dictate" | "voice";

/** One slot on the radial menu. */
export type RadialItem =
  /** The game you're playing (or played last): opens a second wheel of its notes. */
  | { type: "game" }
  | { type: "notes" }
  | { type: "desk" }
  | { type: "web"; url?: string }
  /** Desk Commands, the command palette. */
  | { type: "commands" }
  /** The full achievements page. */
  | { type: "achievements" }
  /** A new note for the current game, in a pop-up over the game. */
  | { type: "quicknote" }
  /** A note pinned to the wheel (separate from pinning in the notes list). */
  | { type: "note"; appId: string; noteId: string; title: string; gameName?: string };

export interface RadialSettings {
  /** The wheel's slots, clockwise from the top; unset = the default four. */
  items?: RadialItem[];
}
export type NotesIn = "popup" | "page";
export type BringForward = "menu" | "qam";
/** What a voice command does with words that don't start with a command. */
export type VoiceFallback = "note" | "append" | "nothing";
/** Where STEAM + L5 + R5 dictation goes: typed into whatever is focused, or saved as a note. */
export type DictateTarget = "type" | "note";

export interface Settings {
  sort?: SortMode;
  sessionRecap?: boolean;
  screenshotPrompt?: boolean;
  /** Turned Steam's own "screenshot saved" popup off (Desk of Madness's RB + A prompt replaces it). */
  hideSteamScreenshotPopup?: boolean;
  /** After a screenshot is attached to a note, delete it from Steam's screenshot library. */
  removeFromSteam?: boolean;
  syncUrl?: string;
  syncToken?: string;
  /** @deprecated replaced by syncInterval */
  autoBackup?: boolean;
  /** Minutes between checks for website edits; 0 = manual only. */
  syncInterval?: number;
  /** Sync as soon as the Deck wakes from sleep, even when checks are manual-only. Default on. */
  syncOnWake?: boolean;
  bookstoreUrl?: string;
  bookstoreUser?: WorkshopUser;
  /** Pin to screen: turn off Steam's own performance stats so only the to-do list shows. */
  overlayHideStats?: boolean;
  /** Pin to screen: where the overlay sits; unset = wherever Steam puts it (top left). Older setting, used
   * when overlayX/overlayY aren't set. */
  overlayPosition?: OverlayPosition;
  /** Pin to screen: exact top-left corner of the list in screen pixels (1280 x 800). */
  overlayX?: number;
  overlayY?: number;
  /** Pin to screen: text size in pixels; unset = 13 (MangoHud's small font). */
  overlayTextSize?: number;
  /** Pin to screen: background opacity, 0-100; unset = 50. */
  overlayOpacity?: number;
  overlayRounded?: boolean;
  /** @deprecated replaced by combos.open */
  openChord?: OpenChord;
  /** Buttons (1 to 4) for each combo; [] = off, unset = the default. */
  combos?: Partial<Record<ComboAction | "tomes", string[]>>;
  /** Keyboard shortcut (1 to 4 keys) for each combo, alongside its buttons; unset or [] = none. */
  keys?: Partial<Record<ComboAction, string[]>>;
  /** The radial menu's slots. */
  radial?: RadialSettings;
  /** Notes from the wheel and the Notes combo: a pop-up over the game (quick) or the full notes page. Unset = popup. */
  notesIn?: NotesIn;
  /** In a game, how Steam's UI is brought in front before our pages show. Unset = the Steam menu. */
  bringForward?: BringForward;
  /** Add "Desk of Madness" to the main Steam-button menu. On unless turned off. */
  mainMenuEntry?: boolean;
  /** Add "Browser" (and "Close browser" while tabs are open) to the main Steam-button menu. On unless turned off. */
  browserMenuEntry?: boolean;
  /** Give Desk of Madness its own Quick Access tab, next to Decky's. */
  qamTab?: boolean;
  /** The dictate combo starts and stops speech to text anywhere. Off unless turned on. */
  dictateChord?: boolean;
  dictateTarget?: DictateTarget;
  /** The voice combo listens for a spoken command (keywords, see voice.ts). Off unless turned on. */
  voiceCommands?: boolean;
  /** Words that aren't a command: "note" (default) saves a new note, "append" adds to the last note. */
  voiceFallback?: VoiceFallback;
  /** Language code for speech to text ("" = detect). */
  speechLanguage?: string;
  /** While notes or the browser are on screen, the trackpads work as on Steam's store pages: the left one
   * scrolls, the right one is a mouse (click = left click). On unless turned off. */
  trackpadMouse?: boolean;
  /** How the left trackpad scrolls the browser: "circle" (default: draw circles, clockwise goes down the page)
   * or "swipe" (slide the thumb, as on the touch screen). */
  padScroll?: PadScroll;
  /** How links in notes open: "reader" (default: just the article, no ads) or "full" (the whole site). */
  browserMode?: BrowserMode;
  /** Games picked in Steam's store open in a new tab of our browser, so the store keeps your place. On unless
   * turned off. */
  storeLinksInBrowser?: boolean;
  /** Reader view text size in pixels; unset = 17. */
  readerTextSize?: number;
  /** The Desk: which Tomes show, in what order, and Tome options. */
  desk?: DeskSettings;
  /** Folders for Decky's plugins (the Plugin Folders Tome, and optionally Decky's own list). */
  pluginFolders?: PluginFolderSettings;
  /** Session tracking options. */
  play?: PlaySettings;
  /** Installed Scrolls: on or off, and each Scroll's own settings. */
  scrolls?: Record<string, ScrollState>;
}

/** One installed Scroll's switch and settings on this Deck. */
export interface ScrollState {
  enabled?: boolean;
  /** Turned itself off (hooks missing, an error): why. Cleared when you turn it on again. */
  offReason?: string;
  settings?: Record<string, unknown>;
}

export type ScrollKind = "code" | "data";

/** What a data Scroll holds (nothing in it can run). */
export interface ScrollData {
  text?: string;
  links?: { title: string; url: string; note?: string }[];
  packs?: string[];
  layout?: DeskLayout;
}

/** An installed Scroll as the backend lists it (no code). */
export interface InstalledScroll {
  id: string;
  name: string;
  icon?: string;
  version?: string;
  kind?: ScrollKind;
  summary?: string;
  description?: string;
  author?: string;
  minDesk?: string;
  permissions?: string[];
  data?: ScrollData;
  size: number;
  signed?: boolean;
  /** Didn't pass the checks on this Deck (changed on disk, or a format this Desk doesn't know). */
  broken?: string;
}

/** A Scroll as the Workshop lists it. */
export interface WorkshopScroll {
  id: string;
  name: string;
  icon: string;
  version: string;
  kind: ScrollKind;
  summary: string;
  description?: string;
  author: WorkshopUser;
  status: string;
  signed: boolean;
  official: boolean;
  size: number;
  installs: number;
  minDesk: string;
  permissions: { id: string; text: string }[];
  contents?: Record<string, number | boolean>;
  updatedAt: number;
}

/** One arrangement of the Desk's Tomes. Tomes not in `order` (new ones) go at the end. */
export interface DeskLayout {
  order: string[];
  /** Tomes taken off the Desk. */
  hidden: string[];
  /** Tomes folded down to their title bar. */
  collapsed: string[];
  /** Tile or card, per Tome (unset = the Tome's own default). */
  sizes?: Record<string, TomeSize>;
  /** Only Tomes in `order` show (pages other than the game page don't pick up new default Tomes). */
  strict?: boolean;
}

export interface DeskSettings {
  /** The layout for games without their own, and when no game is picked. */
  layout?: DeskLayout;
  /** Each game's own layout (per-game layouts). */
  games?: Record<string, DeskLayout>;
  /** Changes made while a game is showing apply to that game only. On unless turned off. */
  perGame?: boolean;
  /** How much Y adds on a counter; unset = 3. */
  counterStep?: number;
  /** Notes opened lately, newest first, per game (for Game Brain and Guides). */
  recent?: Record<string, string[]>;
  /** When the Workshop Tome was last looked at, per game, for its "new" badge. */
  workshopSeen?: Record<string, number>;
  /** @deprecated the old Tome wheel's on/off; false still turns the radial combo off until one is set. */
  radial?: boolean;
  /** Tighter Tomes, to fit more in the Quick Access menu. */
  compact?: boolean;
  /** The Workshop Tome's "new books" badge. On unless turned off. */
  workshopBadge?: boolean;
  /** The Desk's pages, in order (unset = the starter pages). */
  pages?: DeskPage[];
  /** Tile or card, per Tome id, for the layouts that don't say. */
  sizes?: Record<string, TomeSize>;
}

export type TomeSize = "tile" | "card";

/** A folder of Decky plugins, by plugin name. */
export interface PluginFolder {
  id: string;
  name: string;
  icon: string;
  plugins: string[];
}

export interface PluginFolderSettings {
  folders?: PluginFolder[];
  /** The top level's order: "f:<folder id>" or "p:<plugin name>". Anything missing goes after, in Decky's order. */
  order?: string[];
  /** Show the folders in Decky's own plugin list (Quick Access) instead of its flat list. Off unless turned on. */
  inDeckyList?: boolean;
}

/** A page of the Desk. The "game" page uses the per-game layouts; every other page has its own layout. */
export interface DeskPage {
  id: string;
  name: string;
  icon: string;
  /** Unset for the game page (it uses DeskSettings.layout / games). */
  layout?: DeskLayout;
}

export type BrowserMode = "reader" | "full";

/** A web page boiled down to its article (py_modules/reader.py), made by the server or the Deck itself. */
export interface ReaderPage {
  url: string;
  title: string;
  site: string;
  image: string | null;
  excerpt: string;
  /** Plain article markup; still filtered again before it's shown. */
  html: string;
  /** Characters of text in the article. */
  length: number;
  fetchedAt: number;
  cached?: boolean;
  source?: "server" | "device";
}

/** A MediaWiki site (Fandom, wiki.gg, Wikipedia…), for the 📖 Wiki Scroll. */
/** The wikis picked for a game, synced between devices; the newer pick wins. */
export interface WikiChoice {
  /** First = the game's main wiki; empty = none picked. */
  wikis: WikiSite[];
  /** When it was picked (ms). */
  at: number;
}

export interface WikiSite {
  /** https://host[/lang] */
  base: string;
  api: string;
  name: string;
  /** The main page's address. */
  home: string;
  logo: string | null;
  /** A page's address with $1 for its title. */
  articlePath: string;
}

export interface WikiResult {
  title: string;
  url: string;
  snippet: string;
}

/** The server's reader cache settings (admins only). readerCacheDays 0 = never delete. */
export interface ReaderCacheSettings {
  readerCacheDays: number;
  readerCacheChoices: number[];
  readerCache: { pages: number; bytes: number };
}

export type OverlayPosition =
  | "top-left"
  | "top-center"
  | "top-right"
  | "middle-left"
  | "middle-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";

export interface WorkshopUser {
  steamId: string;
  name: string;
  avatar: string;
}

export type EditPolicy = "owner" | "select" | "anyone";

export interface WorkshopSummary {
  id: string;
  appId: string;
  gameName: string;
  title: string;
  firstLine: string;
  kind: NoteKind;
  tags: string[];
  spoiler: boolean;
  spoilerLabel: string;
  author: WorkshopUser;
  likes: number;
  comments: number;
  allowCopy: boolean;
  hasScreenshots: boolean;
  hasVoice: boolean;
  hasChecklist: boolean;
  hasTables?: boolean;
  thumb: string | null;
  createdAt: number;
  updatedAt: number;
  /** ⭐ picked by the Workshop's admins. */
  featured?: boolean;
  /** Times saved to someone's notes. */
  copies?: number;
}

/** 📦 A Note Pack: a collection of Workshop posts, saved to your notes in one go. */
export interface WorkshopPack {
  id: string;
  title: string;
  description: string;
  appId: string | null;
  gameName: string;
  author: WorkshopUser;
  count: number;
  copies: number;
  featured: boolean;
  status: string;
  createdAt: number;
  updatedAt: number;
  entries?: WorkshopSummary[];
}

export interface WorkshopEntry extends WorkshopSummary {
  body: string;
  checklist: ChecklistItem[];
  /** Missing on Workshops from before tables were stored. */
  tables?: NoteTable[];
  refs?: NoteRef[];
  sources?: NoteSource[];
  screenshots: Screenshot[];
  recordings: Recording[];
  editPolicy: EditPolicy;
  editors: WorkshopUser[];
  canEdit: boolean;
  isAuthor: boolean;
  canDelete: boolean;
  liked: boolean;
  commentList: { id: string; text: string; createdAt: number; author: WorkshopUser }[];
}

export interface WorkshopGame {
  appId: string;
  gameName: string;
  count: number;
}

export interface BackupStatus {
  lastBackup: number | null;
  lastError: string | null;
  running: boolean;
  pending: boolean;
}

/** A Steam news post for a game (py_modules/news.py). */
export interface SteamNewsItem {
  id: string;
  title: string;
  url: string;
  author: string;
  feed: string;
  /** ms */
  date: number;
  summary: string;
  image: string;
  official: boolean;
}

/** A note found by Desk Commands' search, from any game. */
export interface NoteHit {
  appId: string;
  gameName: string;
  id: string;
  title: string;
  snippet: string;
  kind?: NoteKind;
  updatedAt: number;
}

/** Something Home Assistant can switch or run (through the Desk server; admins only). */
export interface HomeEntity {
  id: string;
  domain: string;
  name: string;
  /** null for scenes and scripts, which just run. */
  state: string | null;
}

/** A container on the Desk server's machine (through its Docker socket proxy; admins only). */
export interface DockerContainer {
  name: string;
  image: string;
  state: string;
  status: string;
  project: string;
}

// ---------- play statistics (py_modules/playstats.py) ----------

export interface PlayGameTime {
  appId: string;
  name: string;
  seconds: number;
}

export interface PlayStats {
  now: number;
  dayStartHour: number;
  /** When the first counted session started (null = none yet). */
  trackedSince: number | null;
  last: { appId: string; name: string; start: number; seconds: number; live: boolean } | null;
  today: { seconds: number; games: { appId: string; name: string }[] };
  week: { seconds: number; days: { day: string; seconds: number }[] };
  streak: { current: number; best: number; playedToday: boolean };
  records: {
    longest: { appId: string; name: string; start: number; seconds: number } | null;
    averageSeconds: number;
    sessions: number;
    totalSeconds: number;
  };
  mostPlayed: { week: PlayGameTime[]; month: PlayGameTime[]; allTime: PlayGameTime[] };
  /** One entry per day, oldest first, ending today. */
  calendar: { day: string; seconds: number }[];
}

export interface PlaySettings {
  /** Count non-Steam games (shortcuts). On unless turned off. */
  includeNonSteam?: boolean;
  /** Hour a new day starts (0-23); unset = 4. */
  dayStartHour?: number;
  /** Sessions shorter than this many minutes don't count; unset = 5. */
  minMinutes?: number;
}

// ---------- Steam achievements ----------

export interface Achievement {
  id: string;
  name: string;
  description: string;
  icon: string;
  iconGray?: string;
  hidden: boolean;
  /** Seconds since the epoch, 0 = locked. */
  unlockedAt: number;
  /** Percent of players who have it, when known. */
  globalPct?: number;
  /** Progress toward it (e.g. 34 of 100), when Steam tracks one. */
  progress?: { current: number; max: number };
}

export interface GameAchievements {
  appId: string;
  name: string;
  unlocked: number;
  total: number;
  /** Steam's lifetime playtime, in minutes. */
  playtimeMin?: number;
  /** Seconds since the epoch. */
  lastPlayed?: number;
  /** The full list, when it's been fetched. */
  list?: Achievement[];
  /** When the counts or list were last read, ms. */
  updatedAt: number;
}

export interface AchievementData {
  updatedAt: number;
  games: Record<string, GameAchievements>;
}
