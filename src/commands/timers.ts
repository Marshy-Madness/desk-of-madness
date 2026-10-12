import { useSyncExternalStore } from "react";
import { toaster } from "@decky/api";

// Countdown timers from Desk Commands ("timer 5 minutes"). They live for as long as the plugin is loaded and
// toast with a sound when they ring, whether or not the palette is open.

export interface Timer {
  id: number;
  label: string;
  endsAt: number;
  ms: number;
}

let timers: Timer[] = [];
const handles = new Map<number, ReturnType<typeof setTimeout>>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
let nextId = 1;

export const MAX_TIMER_MS = 24 * 60 * 60 * 1000;

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  if (h) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

/** "5 minutes", "1h 30m", "90 seconds", "2:30", "an hour and a half", or a bare number (minutes). */
export function parseDuration(text: string): number | null {
  let t = text
    .toLowerCase()
    .replace(/\bhalf an? hour\b/, "30m")
    .replace(/\band a half\b/, " 30m")
    .replace(/\b(an?|one)\b/g, "1");
  const clock = t.match(/\b(\d+):(\d{1,2})(?::(\d{1,2}))?\b/);
  if (clock) {
    const [a, b, c] = [clock[1], clock[2], clock[3]].map((x) => Number(x ?? 0));
    return (clock[3] != null ? a * 3600 + b * 60 + c : a * 60 + b) * 1000;
  }
  let ms = 0;
  let found = false;
  const re = /(\d+(?:\.\d+)?)\s*(h(?:ours?|rs?)?|m(?:in(?:ute)?s?)?|s(?:ec(?:ond)?s?)?)\b/g;
  for (const m of t.matchAll(re)) {
    found = true;
    const n = Number(m[1]);
    ms += m[2].startsWith("h") ? n * 3_600_000 : m[2].startsWith("m") ? n * 60_000 : n * 1000;
  }
  if (!found) {
    t = t.trim();
    if (/^\d+(?:\.\d+)?$/.test(t)) ms = Number(t) * 60_000;
  }
  return ms > 0 ? Math.min(ms, MAX_TIMER_MS) : null;
}

export function startTimer(ms: number, label = ""): Timer {
  const timer: Timer = { id: nextId++, label: label || formatDuration(ms), endsAt: Date.now() + ms, ms };
  timers = [...timers, timer];
  handles.set(
    timer.id,
    setTimeout(() => {
      stopTimer(timer.id);
      toaster.toast({ title: "⏱ Time's up", body: label || `${formatDuration(ms)} timer`, duration: 15000, playSound: true, critical: true });
    }, ms)
  );
  emit();
  return timer;
}

export function stopTimer(id: number) {
  clearTimeout(handles.get(id));
  handles.delete(id);
  timers = timers.filter((t) => t.id !== id);
  emit();
}

export const stopAllTimers = () => [...timers].forEach((t) => stopTimer(t.id));
export const getTimers = () => timers;

export function useTimers(): Timer[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => timers
  );
}
