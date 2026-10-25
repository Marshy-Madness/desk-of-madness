import { cloneElement, isValidElement } from "react";
import { achievementsCombo, commandsCombo, deskCombo, goNotes, notesCombo, quickNoteCombo, radialComboPressed, webCombo } from "./radial/go";
import { RadialPage } from "./radial/RadialPage";
import { addEventListener, removeEventListener, routerHook } from "@decky/api";
import { afterPatch, ErrorBoundary, findModuleExport, Patch, showModal } from "@decky/ui";
import { FaGlobe, FaRegStickyNote, FaTimesCircle } from "react-icons/fa";
import { NotesPage } from "./components/NotesPage";
import { BrowserPage } from "./components/BrowserPage";
import { QuickAccessPanel } from "./components/QuickAccessPanel";
import { getSettings } from "./state/notesStore";
import { dictationBusy, dictationChordEnabled, stopAnywhereDictation, toggleAnywhereDictation } from "./dictation";
import { NOTES_ROUTE, WEB_ROUTE, reportButtons } from "./opening";
import { ACHIEVEMENTS_ROUTE, COMMANDS_ROUTE, lastPlaceAddress, RADIAL_ROUTE, WEB_CLOSE_ROUTE } from "./state/place";
import { getTabs } from "./browserTabs";
import { BrowserClosePage } from "./components/BrowserClosePage";
import { AchievementsPage } from "./achievements/AchievementsPage";
import { CommandsPage } from "./commands/CommandsPage";
import { stopAllTimers } from "./commands/timers";
import { releaseTrackpads } from "./trackpads";
import { Button, ComboKind, feedRecording, getCombo, getKeys, isRecordingCombo, keysLabel, sortButtons, sortKeys } from "./combos";
import { speechAllowed } from "./state/speech";
import { stopVoiceCommand, toggleVoiceCommand, voiceBusy } from "./voice";
import { ComboAction } from "./types";
import { MenuItem, MenuItemProps, menuHooks, setTabsPatched, tabHooks } from "./scrolls/hooks";
import { AttachScreenshotsModal } from "./components/AttachScreenshotsModal";
import { getPendingScreenshots, screenshotComboArmed } from "./state/pendingScreenshots";

// ---- button combos ----

// Steam's navigation button codes (EGamepadButton), sent while Steam's own screens have focus.
const NAV_BUTTONS: Record<number, Button> = {
  0: "A",
  1: "B",
  2: "X",
  3: "Y",
  4: "UP",
  5: "RIGHT",
  6: "DOWN",
  7: "LEFT",
  8: "MENU",
  9: "VIEW",
  25: "L3",
  28: "L2",
  29: "R2",
  30: "L1",
  31: "R1",
  32: "L5",
  33: "R5",
  34: "STEAM",
  35: "VIEW",
  36: "MENU",
  37: "LPAD",
  39: "RPAD",
  41: "R3",
  44: "L4",
  45: "R4",
};

// The older feed's bits: ulButtons is the low 32 bits of the state, ulUpperButtons the high 32.
const LO_BITS: [number, Button][] = [
  [0x1, "R2"], [0x2, "L2"], [0x4, "R1"], [0x8, "L1"],
  [0x10, "Y"], [0x20, "B"], [0x40, "X"], [0x80, "A"],
  [0x100, "UP"], [0x200, "RIGHT"], [0x400, "LEFT"], [0x800, "DOWN"],
  [0x1000, "VIEW"], [0x2000, "STEAM"], [0x4000, "MENU"],
  [0x8000, "L5"], [0x10000, "R5"], [0x20000, "LPAD"], [0x40000, "RPAD"],
  [0x400000, "L3"], [0x4000000, "R3"],
];
const HI_BITS: [number, Button][] = [
  [0x200, "L4"],
  [0x400, "R4"],
  [0x40000, "QAM"],
];

// Fields of Steam Input's button messages.
const FEED_FIELDS: [string, Button][] = [
  ["button_steam", "STEAM"], ["button_quick_access", "QAM"], ["button_back_view", "VIEW"], ["button_start_options", "MENU"],
  ["button_south", "A"], ["button_east", "B"], ["button_west", "X"], ["button_north", "Y"],
  ["dpad_up", "UP"], ["dpad_down", "DOWN"], ["dpad_left", "LEFT"], ["dpad_right", "RIGHT"],
  ["left_bumper", "L1"], ["right_bumper", "R1"], ["left_trigger", "L2"], ["right_trigger", "R2"],
  ["left_stick_click", "L3"], ["right_stick_click", "R3"],
  ["l4", "L4"], ["r4", "R4"], ["l5", "L5"], ["r5", "R5"],
  ["left_trackpad_click", "LPAD"], ["right_trackpad_click", "RPAD"],
];

// Steam's own button feed (what its controller test page uses). Each controller has to be asked to stream.
type InputService = {
  StartControllerStateFlow(req: { controller_index: number; flow_mode: number }): unknown;
  RegisterForNotifyButtonStateChanged(cb: (msg: { Body(): { toObject(): any } }) => void): { unregister(): void } | null;
};
const BUTTON_FLOW = 0;
const MAX_CONTROLLERS = 8;
const FLOW_REFRESH_MS = 30_000; // Steam's test page ends the flow when it closes; start it again now and then
const REFIRE_MS = 800; // several feeds can report the same press; act on it once
const HELD_ELSEWHERE_MS = 5000; // a feed that's said nothing for this long no longer counts as holding a combo

function findInputService(): InputService | null {
  try {
    return (
      findModuleExport(
        (e: any) => typeof e?.RegisterForNotifyButtonStateChanged === "function" && typeof e?.StartControllerStateFlow === "function"
      ) ?? null
    );
  } catch {
    return null;
  }
}

// Not a setting: RB + A only does anything for a little while after a screenshot (the toast says so).
type Action = ComboAction | "screenshot";
const SCREENSHOT_COMBO: Button[] = ["R1", "A"];

const ACTIONS: ComboAction[] = ["radial", "commands", "open", "quicknote", "desk", "web", "achievements", "dictate", "voice"];

function enabledCombos(kind: ComboKind): { action: Action; buttons: string[] }[] {
  const s = getSettings();
  const on: Record<ComboAction, boolean> = {
    radial: true,
    commands: true,
    open: true,
    quicknote: true,
    desk: true,
    web: true,
    achievements: true,
    dictate: dictationChordEnabled(),
    voice: !!s.voiceCommands && speechAllowed(),
  };
  const list: { action: Action; buttons: string[] }[] = ACTIONS.flatMap((action) => {
    const buttons = on[action] ? (kind === "keys" ? getKeys(action) : getCombo(action)) : null;
    return buttons ? [{ action, buttons }] : [];
  });
  if (kind === "buttons" && screenshotComboArmed()) list.push({ action: "screenshot", buttons: SCREENSHOT_COMBO });
  return list;
}

/** RB + A after a screenshot: the game's notes, with the "add it to a note" prompt on top. */
function attachScreenshotCombo() {
  const pending = getPendingScreenshots();
  if (!pending) return;
  goNotes(pending.appId);
  // Once Steam's in front, or the prompt opens behind the game.
  setTimeout(() => {
    if (getPendingScreenshots() === pending) showModal(<AttachScreenshotsModal pending={pending} />);
  }, 400);
}

function runCombo(action: Action, kind: ComboKind) {
  if (action === "screenshot") attachScreenshotCombo();
  else if (action === "open") notesCombo();
  else if (action === "quicknote") quickNoteCombo();
  // From the keyboard there's no stick to aim with, so letting go doesn't pick: arrows and Enter do.
  else if (action === "radial") radialComboPressed(kind === "keys" ? [] : getCombo("radial") ?? []);
  else if (action === "commands") commandsCombo();
  else if (action === "desk") deskCombo();
  else if (action === "web") webCombo();
  else if (action === "achievements") achievementsCombo();
  else if (action === "dictate") {
    if (voiceBusy()) return;
    toggleAnywhereDictation();
  } else {
    if (dictationBusy()) return;
    toggleVoiceCommand();
  }
}

/**
 * Runs the button combos: the full-screen page, speech to text and voice commands, each on whatever 1 to 4
 * buttons were set for it. When combos overlap (L4 + R4 and STEAM + L4 + R4), the one with the most buttons
 * held wins, and a combo doesn't fire again until its buttons are let go. The main source is the backend
 * reading the Deck's controller directly, since Steam's callbacks don't reach plugins in a game on current
 * SteamOS. Steam's own feeds are kept as extras, for other controllers and older Steam versions.
 * Keyboard shortcuts work the same way on their own: the backend reads every keyboard, and Steam's own
 * windows report keys while they have focus.
 */
function startChordWatch(): () => void {
  // Per controller: the combo that last fired, until its buttons are let go.
  const active = new Map<string, string[]>();
  const lastSeen = new Map<string, number>();
  const lastFired = new Map<Action, number>();

  /** Whether another feed is still holding these buttons (one it reported lately; a feed can go quiet without a let-go). */
  const kindOf = new Map<string, ComboKind>();
  const heldElsewhere = (controller: string, buttons: string[]) =>
    [...active].some(
      ([other, held]) =>
        other !== controller &&
        kindOf.get(other) === kindOf.get(controller) &&
        Date.now() - (lastSeen.get(other) ?? 0) < HELD_ELSEWHERE_MS && buttons.every((b) => held.includes(b))
    );

  const onButtons = (controller: string, down: Set<string>, source: string, kind: ComboKind = "buttons") => {
    lastSeen.set(controller, Date.now());
    kindOf.set(controller, kind);
    const sorted = kind === "keys" ? sortKeys(down) : sortButtons(down);
    reportButtons(kind === "keys" ? (sorted.length ? keysLabel(sorted) : "") : sorted.join(" + "), source);
    if (isRecordingCombo()) {
      feedRecording(kind, controller, down);
      active.set(controller, sorted); // nothing fires until the recorded buttons are let go
      return;
    }
    const all = (list: string[]) => list.every((b) => down.has(b));
    const held = active.get(controller);
    if (held && !all(held)) active.delete(controller);

    const best = enabledCombos(kind)
      .filter((c) => all(c.buttons))
      .sort((a, b) => b.buttons.length - a.buttons.length)[0];
    if (!best) return;
    const current = active.get(controller);
    // Still holding the combo that fired, or a smaller one inside it: nothing new.
    if (current && best.buttons.every((b) => current.includes(b))) return;
    active.set(controller, best.buttons);
    // The same press, still held, seen through another feed. In Steam's menus several feeds report the Deck's
    // buttons, and one letting go for a moment fired the combo again, so the page opened and closed at once.
    if (heldElsewhere(controller, best.buttons)) return;
    if (Date.now() - (lastFired.get(best.action) ?? 0) > REFIRE_MS) {
      lastFired.set(best.action, Date.now());
      runCombo(best.action, kind);
    }
  };

  const cleanups: (() => void)[] = [];

  // The Deck's own controller, read by the backend.
  const onDeck = (names: string[]) => onButtons("deck", new Set(names as Button[]), "Deck controller");
  addEventListener("buttons", onDeck);
  cleanups.push(() => removeEventListener("buttons", onDeck));

  // Every keyboard, read by the backend.
  const onKeys = (names: string[]) => onButtons("keyboard", new Set(names), "keyboard", "keys");
  addEventListener("keys", onKeys);
  cleanups.push(() => removeEventListener("keys", onKeys));
  cleanups.push(watchSteamKeys((down) => onButtons("steamkeys", down, "keyboard (Steam window)", "keys")));

  // Steam's navigation input: only while Steam's screens have focus, but covers any controller.
  const navDown = new Map<number, Set<Button>>();
  const nav = (window as any).SteamClient?.Input?.RegisterForControllerInputMessages?.(
    (index: number, button: number, pressed: boolean) => {
      const name = NAV_BUTTONS[button];
      if (!name) return;
      const down = navDown.get(index) ?? new Set<Button>();
      navDown.set(index, down);
      if (pressed) down.add(name);
      else down.delete(name);
      onButtons(`nav${index}`, new Set(down), "Steam menus");
    }
  );
  if (nav) cleanups.push(() => nav.unregister());

  const service = findInputService();
  const feed = service?.RegisterForNotifyButtonStateChanged((msg) => {
    const t = msg.Body().toObject();
    const down = new Set<Button>(FEED_FIELDS.filter(([f]) => t[f]).map(([, b]) => b));
    onButtons(`feed${t.controller_index}`, down, "Steam Input");
  });
  if (service && feed) {
    const startFlows = () => {
      for (let i = 0; i < MAX_CONTROLLERS; i++) {
        try {
          // Controllers that aren't connected just fail; that's fine.
          Promise.resolve(service.StartControllerStateFlow({ controller_index: i, flow_mode: BUTTON_FLOW })).catch(() => {});
        } catch (e) {
          console.warn("Desk of Madness: couldn't start the button feed", i, e);
        }
      }
    };
    startFlows();
    const timer = setInterval(startFlows, FLOW_REFRESH_MS);
    cleanups.push(() => {
      clearInterval(timer);
      feed.unregister();
    });
  }

  const stateButtons = new Map<number, [number, number]>();
  const legacy = (window as any).SteamClient?.Input?.RegisterForControllerStateChanges?.(
    (changes: { unControllerIndex: number; ulButtons: number; ulUpperButtons: number }[]) => {
      for (const c of changes) {
        const lo = Number(c.ulButtons) || 0;
        const hi = Number(c.ulUpperButtons) || 0;
        // This fires for every stick, trackpad and gyro movement too; only button changes need the combo check.
        const was = stateButtons.get(c.unControllerIndex);
        if (was && was[0] === lo && was[1] === hi) {
          lastSeen.set(`state${c.unControllerIndex}`, Date.now());
          continue;
        }
        stateButtons.set(c.unControllerIndex, [lo, hi]);
        const down = new Set<Button>([
          ...LO_BITS.filter(([b]) => lo & b).map(([, n]) => n),
          ...HI_BITS.filter(([b]) => hi & b).map(([, n]) => n),
        ]);
        onButtons(`state${c.unControllerIndex}`, down, "Steam controller state");
      }
    }
  );
  if (legacy) cleanups.push(() => legacy.unregister());

  return () => {
    cleanups.forEach((c) => c());
    stopAnywhereDictation();
    stopVoiceCommand();
  };
}

// What the backend calls the keys (py_modules/keyboard.py), by KeyboardEvent.code.
function keyName(code: string): string | null {
  const named: Record<string, string> = {
    ControlLeft: "CTRL", ControlRight: "CTRL", ShiftLeft: "SHIFT", ShiftRight: "SHIFT", AltLeft: "ALT", AltRight: "ALT",
    MetaLeft: "META", MetaRight: "META", OSLeft: "META", OSRight: "META", Escape: "ESC", Backspace: "BACKSPACE",
    Tab: "TAB", Enter: "ENTER", Space: "SPACE", CapsLock: "CAPSLOCK", NumLock: "NUMLOCK", ScrollLock: "SCROLLLOCK",
    PrintScreen: "PRINT", Pause: "PAUSE", ContextMenu: "MENU", Home: "HOME", End: "END", PageUp: "PAGEUP",
    PageDown: "PAGEDOWN", Insert: "INSERT", Delete: "DELETE", ArrowUp: "UP", ArrowDown: "DOWN", ArrowLeft: "LEFT",
    ArrowRight: "RIGHT", Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]", Semicolon: ";", Quote: "'",
    Backquote: "`", Backslash: "\\", Comma: ",", Period: ".", Slash: "/", NumpadMultiply: "NUM*",
    NumpadSubtract: "NUM-", NumpadAdd: "NUM+", NumpadDecimal: "NUM.", NumpadEnter: "NUMENTER", NumpadDivide: "NUM/",
  };
  if (named[code]) return named[code];
  const m = /^(?:Key([A-Z])|Digit(\d)|(F\d+)|Numpad(\d))$/.exec(code);
  if (!m) return null;
  return m[1] ?? m[2] ?? m[3] ?? `NUM${m[4]}`;
}

/**
 * Keys pressed while Steam's own big-screen window has focus. A backup for when the backend can't read
 * keyboards (the plugin's user isn't in the input group); in a game only the backend sees them.
 */
function watchSteamKeys(onChange: (down: Set<string>) => void): () => void {
  let win: Window | undefined;
  try {
    win = (window as any).SteamUIStore?.WindowStore?.GamepadUIMainWindowInstance?.BrowserWindow;
  } catch {
    win = undefined;
  }
  if (!win?.addEventListener) return () => {};
  const down = new Set<string>();
  const onKey = (e: KeyboardEvent) => {
    const name = keyName(e.code);
    if (!name || e.repeat) return;
    const had = down.has(name);
    if (e.type === "keydown") down.add(name);
    else down.delete(name);
    if (had !== down.has(name)) onChange(new Set(down));
  };
  const onBlur = () => {
    if (!down.size) return;
    down.clear(); // the key-up went somewhere else
    onChange(new Set());
  };
  win.addEventListener("keydown", onKey, true);
  win.addEventListener("keyup", onKey, true);
  win.addEventListener("blur", onBlur);
  return () => {
    win!.removeEventListener("keydown", onKey, true);
    win!.removeEventListener("keyup", onKey, true);
    win!.removeEventListener("blur", onBlur);
  };
}

// ---- main Steam menu ----

const MENU_KEY = "desk-of-madness";

const BROWSER_KEY = "desk-of-madness-browser";
const BROWSER_CLOSE_KEY = "desk-of-madness-browser-close";

/** On unless turned off in Settings. */
const mainMenuOn = () => getSettings().mainMenuEntry !== false;
const browserMenuOn = () => getSettings().browserMenuEntry !== false;

const hasSettings = (list: unknown[]) => list.some((e) => isValidElement(e) && e.key === "settings");

/** Returns the menu's item list with our entry (and the Scrolls' changes), or null if it's not the main menu or nothing changed. */
function withNotesItem(items: unknown): MenuItem[] | null {
  if (!Array.isArray(items) || !hasSettings(items)) return null;
  let list = items as MenuItem[];
  const after = ["downloads", "media", "library"].map((k) => list.findIndex((e) => e.key === k)).find((i) => i >= 0);
  if (after === undefined) return null;
  const template = list[after];
  const makeItem = (props: MenuItemProps) =>
    cloneElement(template, { routeState: undefined, active: "if-within-route", ...props } as any) as MenuItem;
  let changed = false;
  if (mainMenuOn() && !list.some((e) => e.key === MENU_KEY)) {
    // At the very top, above the running game, so it's the first thing under the Steam button.
    const route = lastPlaceAddress() ?? NOTES_ROUTE;
    list = [makeItem({ key: MENU_KEY, route, label: "Desk of Madness", icon: <FaRegStickyNote /> }), ...list];
    changed = true;
  }
  if (browserMenuOn() && !list.some((e) => e.key === BROWSER_KEY)) {
    // Under our own entry (or at the top): the browser comes back on the tabs you left open, and while any
    // are open there's a way to close it from here too.
    const at = list.findIndex((e) => e.key === MENU_KEY) + 1;
    const open = getTabs().length;
    const items = [
      makeItem({ key: BROWSER_KEY, route: WEB_ROUTE, label: open ? `Browser (${open} ${open === 1 ? "tab" : "tabs"})` : "Browser", icon: <FaGlobe /> }),
      ...(open ? [makeItem({ key: BROWSER_CLOSE_KEY, route: WEB_CLOSE_ROUTE, label: "Close browser", icon: <FaTimesCircle /> })] : []),
    ];
    list = [...list.slice(0, at), ...items, ...list.slice(at)];
    changed = true;
  }
  for (const hook of menuHooks) {
    try {
      const next = hook(list, makeItem);
      if (next !== list) {
        list = next;
        changed = true;
      }
    } catch (e) {
      console.warn("Desk of Madness: a Scroll's main-menu change failed", e);
    }
  }
  return changed ? list : null;
}

/**
 * Steam builds the main menu's items inside its own code, then passes them as children to a Focusable with
 * role "menu". Newer Steam makes Focusable a plain function we can't patch in place, so we watch for it where
 * elements are made instead and add our item there, copied from the Downloads entry so it looks and behaves
 * the same. Depending on the build Steam makes elements with React.createElement (children as extra arguments)
 * or the JSX runtime's jsx/jsxs (children in props, the key as the third argument), so all three are watched.
 * We don't compare the type with @decky/ui's Focusable: that lookup can land on a different copy than the menu
 * uses, which silently hid the entry. withNotesItem checks the items instead.
 */
function patchMainMenu(): (() => void) | null {
  const w = window as any;
  const withItem = (type: unknown, props: any, children: unknown[]) => {
    if (typeof type === "string" || !(mainMenuOn() || browserMenuOn() || menuHooks.size)) return { props, children };
    try {
      // Children come either as extra arguments or in props.children, possibly one array deep.
      if (children.length) return { props, children: children.map((c) => withNotesItem(c) ?? c) };
      if (props.children) {
        const kids = props.children;
        const direct = withNotesItem(kids);
        const next = direct ?? (Array.isArray(kids) ? kids.map((c: unknown) => withNotesItem(c) ?? c) : kids);
        return { props: { ...props, children: next }, children };
      }
    } catch (e) {
      console.warn("Desk of Madness: couldn't add the Steam menu entry", e);
    }
    return { props, children };
  };

  const undo: (() => void)[] = [];
  const patch = (obj: any, name: string, childrenAsArgs: boolean) => {
    const original = obj?.[name];
    if (typeof original !== "function") return;
    // Every element Steam's UI makes goes through here, so anything that isn't a menu goes straight on,
    // without copying its arguments.
    const patched = function (this: unknown, type: unknown, props: any) {
      // eslint-disable-next-line prefer-rest-params
      if (props?.role !== "menu") return original.apply(this, arguments as any);
      // eslint-disable-next-line prefer-rest-params
      const rest: unknown[] = Array.prototype.slice.call(arguments, 2);
      if (childrenAsArgs) {
        const r = withItem(type, props, rest);
        return original.call(this, type, r.props, ...r.children);
      }
      return original.call(this, type, withItem(type, props, []).props, ...rest);
    };
    try {
      obj[name] = patched;
    } catch (e) {
      console.warn(`Desk of Madness: couldn't watch ${name} for the Steam menu`, e);
      return;
    }
    undo.push(() => {
      if (obj[name] === patched) obj[name] = original;
    });
  };
  patch(w.SP_REACT, "createElement", true);
  patch(w.SP_JSX, "jsx", false);
  patch(w.SP_JSX, "jsxs", false);
  if (!undo.length) return null;
  return () => undo.forEach((u) => u());
}

// ---- own Quick Access tab ----

const QAM_TAB_KEY = 735101;

/**
 * Decky's own tab hook adds its tab to the Quick Access menu on every render; we ride along on it and
 * add (or remove) ours depending on the setting.
 */
function patchQamTabs(): Patch | null {
  const hook = (window as any).__TABS_HOOK_INSTANCE;
  if (typeof hook?.render !== "function") return null;
  return afterPatch(hook, "render", (args: any[], ret: any) => {
    const tabs = args[0];
    if (!Array.isArray(tabs)) return ret;
    const i = tabs.findIndex((t) => t?.key === QAM_TAB_KEY);
    if (getSettings().qamTab) {
      if (i < 0) {
        tabs.push({
          key: QAM_TAB_KEY,
          title: "Desk of Madness",
          tab: <FaRegStickyNote />,
          panel: (
            <ErrorBoundary>
              <QuickAccessPanel />
            </ErrorBoundary>
          ),
        });
      }
    } else if (i >= 0) {
      tabs.splice(i, 1);
    }
    for (const hook of tabHooks) {
      try {
        hook(tabs);
      } catch (e) {
        console.warn("Desk of Madness: a Scroll's Quick Access change failed", e);
      }
    }
    return ret;
  });
}

/** Sets up the full-screen page, button combo, main-menu entry and Quick Access tab. Returns a cleanup. */
export function startIntegrations(): () => void {
  // Not exact: the rest of the address is where you are (state/place.ts).
  routerHook.addRoute(NOTES_ROUTE, NotesPage);
  routerHook.addRoute(WEB_ROUTE, BrowserPage, { exact: true });
  routerHook.addRoute(WEB_CLOSE_ROUTE, BrowserClosePage, { exact: true });
  routerHook.addRoute(RADIAL_ROUTE, RadialPage, { exact: true });
  routerHook.addRoute(COMMANDS_ROUTE, CommandsPage, { exact: true });
  routerHook.addRoute(ACHIEVEMENTS_ROUTE, AchievementsPage, { exact: true });
  const stopChord = startChordWatch();
  const patches = [patchQamTabs()];
  setTabsPatched(!!patches[0]);
  const unpatchMenu = patchMainMenu();
  return () => {
    stopChord();
    patches.forEach((p) => p?.unpatch());
    unpatchMenu?.();
    routerHook.removeRoute(NOTES_ROUTE);
    routerHook.removeRoute(WEB_ROUTE);
    routerHook.removeRoute(WEB_CLOSE_ROUTE);
    routerHook.removeRoute(RADIAL_ROUTE);
    routerHook.removeRoute(COMMANDS_ROUTE);
    routerHook.removeRoute(ACHIEVEMENTS_ROUTE);
    stopAllTimers();
    releaseTrackpads();
  };
}
