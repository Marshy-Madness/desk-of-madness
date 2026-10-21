import { useSyncExternalStore } from "react";
import { getSettings } from "./state/notesStore";
import { ComboAction, OpenChord } from "./types";

// Button combos: which buttons each action needs, and recording a new combo by holding it.

export const BUTTONS = [
  "STEAM", "QAM", "VIEW", "MENU",
  "A", "B", "X", "Y",
  "UP", "DOWN", "LEFT", "RIGHT",
  "L1", "R1", "L2", "R2",
  "L3", "R3", "L4", "R4", "L5", "R5",
  "LPAD", "RPAD",
] as const;
export type Button = (typeof BUTTONS)[number];

export const MAX_COMBO = 4;

// Buttons Steam's menus need. One of these on its own can't be a combo: it would fire on every press (an
// A combo opened the browser whenever you picked anything).
const MENU_BUTTONS = new Set<Button>([
  "STEAM", "QAM", "VIEW", "MENU", "A", "B", "X", "Y", "UP", "DOWN", "LEFT", "RIGHT", "L1", "R1", "L2", "R2",
]);

/** Whether `combo` can be used: not empty, and not a single button the menus need. */
export const usableCombo = (combo: Button[]) => combo.length > 1 || (combo.length === 1 && !MENU_BUTTONS.has(combo[0]));

const LABELS: Partial<Record<Button, string>> = {
  QAM: "···",
  VIEW: "View",
  MENU: "Menu",
  UP: "D-pad ↑",
  DOWN: "D-pad ↓",
  LEFT: "D-pad ←",
  RIGHT: "D-pad →",
  L3: "L3 (stick click)",
  R3: "R3 (stick click)",
  LPAD: "Left trackpad click",
  RPAD: "Right trackpad click",
};

export const buttonLabel = (b: Button) => LABELS[b] ?? b;
export const comboLabel = (combo: Button[] | null) =>
  combo?.length ? combo.map(buttonLabel).join(" + ") : "Off";

/** Puts buttons in a fixed order, so the same combo always reads the same way. */
export const sortButtons = (list: Iterable<string>): Button[] =>
  BUTTONS.filter((b) => new Set(list).has(b));

const OLD_CHORDS: Record<OpenChord, Button[]> = {
  l4r4: ["L4", "R4"],
  l5r5: ["L5", "R5"],
  l3r3: ["L3", "R3"],
  off: [],
};

// Desk and Web Browser start off: they're for people who want a button straight to them.
export const DEFAULT_COMBOS: Record<ComboAction, Button[]> = {
  radial: ["R4", "R5"],
  commands: ["L5", "R5"],
  open: ["L4", "R4"],
  quicknote: [],
  desk: [],
  web: [],
  achievements: [],
  dictate: ["STEAM", "L5", "R5"],
  voice: ["STEAM", "L4", "R4"],
};

/** The combo for an action, or null if it's off. Settings from before custom combos still count. */
export function getCombo(action: ComboAction): Button[] | null {
  const s = getSettings();
  let combo = s.combos?.[action] as Button[] | undefined;
  if (!combo && action === "open" && s.openChord) combo = OLD_CHORDS[s.openChord];
  if (!combo && action === "radial") combo = (s.combos?.tomes as Button[] | undefined) ?? (s.desk?.radial === false ? [] : undefined);
  combo = combo ? sortButtons(combo) : DEFAULT_COMBOS[action];
  return usableCombo(combo) ? combo : null; // a lone A saved by older versions counts as off
}

// ---- keyboard shortcuts: up to four keys, read by the backend from any keyboard ----

const MODIFIERS = ["CTRL", "ALT", "SHIFT", "META"];
// Keys that don't type anything or move around, so they're fine without Ctrl, Alt or Super.
const FREE_KEY = /^(F\d+|PAUSE|SCROLLLOCK|INSERT|MENU|KEY\d+)$/;

const KEY_LABELS: Record<string, string> = {
  CTRL: "Ctrl", ALT: "Alt", SHIFT: "Shift", META: "Super",
  ESC: "Esc", BACKSPACE: "Backspace", TAB: "Tab", ENTER: "Enter", SPACE: "Space", CAPSLOCK: "Caps Lock",
  NUMLOCK: "Num Lock", SCROLLLOCK: "Scroll Lock", PRINT: "Print Screen", PAUSE: "Pause", MENU: "Menu key",
  HOME: "Home", END: "End", PAGEUP: "Page Up", PAGEDOWN: "Page Down", INSERT: "Insert", DELETE: "Delete",
  UP: "↑", DOWN: "↓", LEFT: "←", RIGHT: "→", NUMENTER: "Num Enter",
};

export const keyLabel = (k: string) => KEY_LABELS[k] ?? (k.startsWith("NUM") ? `Num ${k.slice(3)}` : k);
export const keysLabel = (keys: string[] | null) => (keys?.length ? keys.map(keyLabel).join(" + ") : "Off");

/** Modifiers first (Ctrl, Alt, Shift, Super), then the rest in a fixed order. */
export const sortKeys = (list: Iterable<string>): string[] => {
  const keys = [...new Set(list)];
  const rank = (k: string) => (MODIFIERS.includes(k) ? MODIFIERS.indexOf(k) : MODIFIERS.length);
  return keys.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
};

/** Whether `keys` can be a shortcut without firing while you type: Ctrl, Alt or Super with another key, or F-keys and the like. */
export function usableKeys(keys: string[]): boolean {
  const rest = keys.filter((k) => !MODIFIERS.includes(k));
  if (!rest.length) return false;
  return keys.some((k) => k !== "SHIFT" && MODIFIERS.includes(k)) || rest.every((k) => FREE_KEY.test(k));
}

/** The keyboard shortcut for an action, or null if it has none. */
export function getKeys(action: ComboAction): string[] | null {
  const keys = sortKeys(getSettings().keys?.[action] ?? []);
  return usableKeys(keys) ? keys : null;
}

// ---- recording a combo: hold the buttons (or keys), let go, and the most you held at once becomes the combo ----

export type ComboKind = "buttons" | "keys";

// Several feeds report the same buttons; the first one to see a button press is the one we listen to, so
// another feed reporting "nothing held" can't end the recording early.
// The button that pressed "Change" reaches us a moment after recording starts (the controller feed lags
// behind Steam's menus), so buttons pressed in the first moment are left out until they're let go.
const GRACE_MS = 400;
type Recording = {
  action: ComboAction;
  kind: ComboKind;
  most: string[];
  source: string | null;
  startedAt: number;
  ignore: Set<string>;
  onDone: (combo: string[]) => void;
};
let recording: Recording | null = null;
let preview: string[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function startRecordingCombo(action: ComboAction, kind: ComboKind, onDone: (combo: string[]) => void) {
  recording = { action, kind, most: [], source: null, startedAt: Date.now(), ignore: new Set(), onDone };
  preview = [];
  emit();
}

export function cancelRecordingCombo() {
  recording = null;
  preview = [];
  emit();
}

/** While recording, the combo watcher hands every change here and doesn't run any combos. */
export function isRecordingCombo(): boolean {
  return recording !== null;
}

export function feedRecording(kind: ComboKind, source: string, down: Set<string>) {
  const r = recording;
  if (!r || r.kind !== kind) return;
  if (Date.now() - r.startedAt < GRACE_MS) {
    down.forEach((b) => r.ignore.add(b));
    return;
  }
  for (const b of r.ignore) if (!down.has(b)) r.ignore.delete(b);
  down = new Set([...down].filter((b) => !r.ignore.has(b)));
  if (!r.source && down.size) r.source = source;
  if (r.source !== source) return;
  const now = kind === "keys" ? sortKeys(down) : sortButtons(down);
  if (now.length > r.most.length) r.most = now.slice(0, MAX_COMBO);
  preview = now.length ? now.slice(0, MAX_COMBO) : r.most;
  if (!now.length && r.most.length) {
    recording = null;
    r.onDone(r.most);
  }
  emit();
}

export function useComboRecording(): { action: ComboAction | null; preview: string[] } {
  const action = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => recording?.action ?? null
  );
  const shown = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => preview
  );
  return { action, preview: shown };
}
