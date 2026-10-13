import { backend } from "../api/backend";
import { closeNotesPage, isNotesPageShowing, showPage } from "../opening";
import { getRunningGame } from "../hooks/useAppLifetime";
import { deskGame, pointDeskAt } from "../state/deskGame";
import { ACHIEVEMENTS_ROUTE, COMMANDS_ROUTE, lastPlaceAddress, NOTES_ROUTE, parsePlace, RADIAL_ROUTE, WEB_ROUTE } from "../state/place";
import { webPath } from "../browser";
import { Popup, popupsOn } from "./popup";

// Where the radial menu's slots and the Notes / Desk / Web Browser button combos take you.

const enc = encodeURIComponent;

/** The game to show: the one running, else the one the Desk showed last. */
export const currentGameId = (): string | null => getRunningGame()?.appId ?? deskGame.last;

/** The game's notes list (on the Desk tab), or the list of games when there's no game. */
export function goNotes(appId: string | null = currentGameId()) {
  if (!appId) return showPage(`${NOTES_ROUTE}/all`);
  pointDeskAt(appId);
  showPage(`${NOTES_ROUTE}/desk/${enc(appId)}/view/notes`);
}

export function goDesk(appId: string | null = currentGameId()) {
  pointDeskAt(appId);
  showPage(`${NOTES_ROUTE}/desk${appId ? `/${enc(appId)}` : ""}`);
}

/** A new note for the game, in its notes list's editor. */
export function goNewNote(appId: string) {
  pointDeskAt(appId);
  showPage(`${NOTES_ROUTE}/desk/${enc(appId)}/view/notes/edit/new`);
}

/** Opens a note straight in the editor. */
export function goEditNote(appId: string, noteId: string) {
  pointDeskAt(appId);
  showPage(`${NOTES_ROUTE}/desk/${enc(appId)}/view/notes/edit/${enc(noteId)}`);
}

export type CommandsView = "main" | "search" | "timer" | "dice" | "home" | "docker" | "games";

/** Desk Commands, the command palette: its main list, or straight into one of its pages. */
export function goCommands(opts: { view?: CommandsView; q?: string } = {}) {
  const params = new URLSearchParams();
  if (opts.view && opts.view !== "main") params.set("view", opts.view);
  if (opts.q) params.set("q", opts.q);
  const query = params.toString();
  showPage(COMMANDS_ROUTE + (query ? `?${query}` : ""));
}

/** The full achievements page: the library, or one game's list. */
export function goAchievements(appId?: string | null, view?: "library" | "timeline") {
  const params = new URLSearchParams();
  if (appId) params.set("app", appId);
  if (view) params.set("view", view);
  const query = params.toString();
  showPage(ACHIEVEMENTS_ROUTE + (query ? `?${query}` : ""));
}

/** Opens one note in its game's notes list. */
export function goNote(appId: string, noteId: string) {
  pointDeskAt(appId);
  showPage(`${NOTES_ROUTE}/desk/${enc(appId)}/view/notes/note/${enc(noteId)}`);
}

let lastWeb: string | null = null;
/** Called by the browser page as its address changes, so the Web Browser slot goes back to it. */
export const rememberWebAddress = (path: string) => (lastWeb = path);

/** The browser: a set page, or the page you had open last (a search page the first time). */
export function goWeb(url?: string) {
  showPage(url ? webPath(url) : lastWeb ?? WEB_ROUTE);
}

// ---- the combos: each opens its page, or puts our pages away if one is already showing ----

/** Notes combo: back where you were if that was this game's notes, otherwise this game's notes list. */
export function notesCombo() {
  if (isNotesPageShowing()) return closeNotesPage();
  if (popupsOn() && currentGameId()) return notesFromWheel();
  const last = lastPlaceAddress();
  const p = last ? parsePlace(last) : null;
  const running = getRunningGame()?.appId;
  const inNotes = p && ((p.tab === "all" && p.openGame) || (p.tab === "desk" && p.appId && p.deskView === "notes"));
  if (last && inNotes && (!running || p.appId === running)) return showPage(last);
  goNotes();
}

export const deskCombo = () => (isNotesPageShowing() ? closeNotesPage() : goDesk());
export const webCombo = () => (isNotesPageShowing() ? closeNotesPage() : goWeb());
export const achievementsCombo = () => (isNotesPageShowing() ? closeNotesPage() : goAchievements());
export const commandsCombo = () => (isNotesPageShowing() ? closeNotesPage() : goCommands());

// ---- the radial menu ----

let radialCombo: { buttons: string[]; at: number } | null = null;
let radialBackdrop: { shot: Promise<string | null>; at: number } | null = null;
let radialPopup: { popup: Popup; at: number } | null = null;

/** The radial page, with a picture of the game grabbed now (it's still on screen) for it to sit over. */
function openRadialPage() {
  radialBackdrop = getRunningGame() ? { shot: backend.captureBackdrop().catch(() => null), at: Date.now() } : null;
  showPage(RADIAL_ROUTE);
}

/** Opens the radial menu (or closes our pages if one is showing). `buttons`: letting go of them picks. */
export function radialComboPressed(buttons: string[]) {
  if (isNotesPageShowing()) return closeNotesPage();
  radialCombo = { buttons, at: Date.now() };
  openRadialPage();
}

// The radial page, while it's showing, runs pop-ups itself.
let popupRunner: ((p: Popup) => void) | null = null;
export const setPopupRunner = (run: ((p: Popup) => void) | null) => (popupRunner = run);

/** A note, a new note or a game's notes list in a pop-up over the game (on the radial page, wheel hidden). */
export function showPopup(p: Popup) {
  if (popupRunner) return popupRunner(p);
  radialPopup = { popup: p, at: Date.now() };
  openRadialPage();
}

/** The pop-up to show, taken once by the radial page as it mounts. */
export function takeRadialPopup(): Popup | null {
  const r = radialPopup;
  radialPopup = null;
  return r && Date.now() - r.at < 3000 ? r.popup : null;
}

/** Quick note combo and wheel slot: a new note for the current game, in a pop-up. */
export function quickNote(appId: string | null = currentGameId()) {
  if (!appId) return goNotes(null);
  pointDeskAt(appId);
  showPopup({ kind: "new", appId });
}

export const quickNoteCombo = () => (isNotesPageShowing() ? closeNotesPage() : quickNote());

/** A note from the wheel: a pop-up, or in its notes list on the full page (Settings → Controls). */
export function openNoteFromWheel(appId: string, noteId: string) {
  if (!popupsOn()) return goNote(appId, noteId);
  pointDeskAt(appId);
  showPopup({ kind: "note", appId, noteId });
}

/** The game's notes: a pop-up list, or the full notes page. */
export function notesFromWheel(appId: string | null = currentGameId()) {
  if (!popupsOn() || !appId) return goNotes(appId);
  pointDeskAt(appId);
  showPopup({ kind: "list", appId });
}

/** The combo that opened the menu, taken once by the page as it mounts (stale ones are dropped). */
export function takeRadialCombo(): string[] {
  const r = radialCombo;
  radialCombo = null;
  return r && Date.now() - r.at < 3000 ? r.buttons : [];
}

/** The picture of the game taken as the combo went down, taken once by the page as it mounts. */
export function takeRadialBackdrop(): Promise<string | null> | null {
  const r = radialBackdrop;
  radialBackdrop = null;
  return r && Date.now() - r.at < 3000 ? r.shot : null;
}
