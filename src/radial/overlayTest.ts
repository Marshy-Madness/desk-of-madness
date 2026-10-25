import { useSyncExternalStore } from "react";
import { addEventListener, removeEventListener, toaster } from "@decky/api";
import { Router } from "@decky/ui";
import { backend } from "../api/backend";
import { closeNotesPage } from "../opening";
import { getRunningGame } from "../hooks/useAppLifetime";

// Test (Settings → Controls): can the radial menu be drawn right over a running game, instead of on a page with
// a screenshot behind it? Steam keeps other windows besides its main one (the Quick Access menu and toasts sit in
// one gamescope lays over the game). This draws a labelled ring into each of them for a few seconds, reads the
// right stick meanwhile, and keeps a report of which windows there were. On the Deck: does a ring show over the
// game, which label does it carry, and does the game react to the stick while it's up?

const WAIT_MS = 3000; // time to get back into the game
const SHOW_MS = 10000;
const MARK = "dom-overlay-test";

type Candidate = { label: string; win: Window };

/** Every Steam UI window we can reach, the main one first, each once. */
function windows(): Candidate[] {
  const store = (Router as any)?.WindowStore;
  const found: Candidate[] = [];
  const add = (label: string, win: any) => {
    if (win?.document && !found.some((c) => c.win === win)) found.push({ label, win });
  };
  add("main", store?.GamepadUIMainWindowInstance?.BrowserWindow);
  (store?.SteamUIWindows ?? []).forEach((w: any, i: number) => add(`SteamUIWindows[${i}]`, w?.BrowserWindow));
  (store?.OverlayWindows ?? []).forEach((w: any, i: number) => add(`OverlayWindows[${i}]`, w?.BrowserWindow));
  add("plugin", window);
  return found;
}

function describe({ label, win }: Candidate) {
  try {
    const d = win.document;
    return `${label}: "${d.title}" ${win.innerWidth}x${win.innerHeight} ${d.visibilityState}`;
  } catch (e) {
    return `${label}: can't read (${e})`;
  }
}

function drawRing({ label, win }: Candidate): HTMLElement | null {
  try {
    const d = win.document;
    const box = d.createElement("div");
    box.className = MARK;
    box.style.cssText =
      "position:fixed;inset:0;z-index:2147483647;pointer-events:none;display:flex;align-items:center;justify-content:center;";
    const ring = d.createElement("div");
    ring.style.cssText =
      "width:300px;height:300px;border-radius:50%;border:6px solid #ff3b9a;background:rgba(20,10,30,0.55);color:#fff;" +
      "display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;" +
      "font:600 18px sans-serif;gap:8px;padding:24px;box-sizing:border-box;";
    ring.innerHTML = `<div>${label}</div><div style="font-size:14px;opacity:.85">Move the right stick.<br>Does the game move too?</div><div data-live style="font-size:14px">stick 0, 0</div>`;
    box.appendChild(ring);
    d.body.appendChild(box);
    return box;
  } catch (e) {
    console.warn(`Desk of Madness: overlay test couldn't draw in ${label}`, e);
    return null;
  }
}

// The last report, for Settings to show.
let report: string[] = [];
let running = false;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());

export function useOverlayTest(): { running: boolean; report: string[] } {
  useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => report
  );
  return { running, report };
}

export async function runOverlayTest() {
  if (running) return;
  running = true;
  report = ["Waiting for the game…"];
  changed();
  toaster.toast({ title: "Over-the-game test", body: `Back to the game: a ring shows in ${WAIT_MS / 1000} s for ${SHOW_MS / 1000} s.` });
  closeNotesPage();
  await new Promise((r) => setTimeout(r, WAIT_MS));

  const lines: string[] = [`Game running: ${getRunningGame()?.name ?? "no"}`];
  try {
    const desired = await (window as any).SteamClient?.UI?.GetDesiredSteamUIWindows?.();
    if (Array.isArray(desired))
      desired.forEach((w: any) => lines.push(`Steam window: type ${w.windowType} "${w.strAppName}" app ${w.appid} at ${w.x},${w.y}`));
  } catch {}

  const all = windows();
  all.forEach((c) => lines.push(describe(c)));
  // The main window is behind the game, so it's left out; every other one gets a ring.
  const boxes = all.filter((c) => c.label !== "main").map((c) => drawRing(c)).filter((b): b is HTMLElement => !!b);
  lines.push(`Drew rings in ${boxes.length} window(s)`);

  let moves = 0;
  let presses: string[] = [];
  const onStick = (x: number, y: number) => {
    moves++;
    boxes.forEach((b) => {
      const live = b.querySelector("[data-live]");
      if (live) live.textContent = `stick ${x}, ${y}`;
    });
  };
  const onButtons = (names: string[]) => (presses = [...presses, ...names].slice(-12));
  addEventListener("stick", onStick);
  addEventListener("buttons", onButtons);
  backend.stickFeed(true).catch(() => {});

  await new Promise((r) => setTimeout(r, SHOW_MS));

  backend.stickFeed(false).catch(() => {});
  removeEventListener("stick", onStick);
  removeEventListener("buttons", onButtons);
  boxes.forEach((b) => b.remove());
  lines.push(`Stick updates read: ${moves}`, `Buttons seen: ${presses.join(", ") || "none"}`);
  console.info("Desk of Madness: overlay test\n" + lines.join("\n"));
  report = lines;
  running = false;
  changed();
  toaster.toast({ title: "Over-the-game test done", body: "Results are in Settings → Controls." });
}
