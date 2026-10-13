import { useSyncExternalStore } from "react";

/** Screenshots taken in-game that haven't been attached to a note or dismissed yet. */
export interface PendingShots {
  appId: string;
  paths: string[];
}

let pending: PendingShots | null = null;
// RB + A attaches the screenshots for a little while after one is taken.
const COMBO_WINDOW_MS = 20_000;
let comboUntil = 0;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((l) => l());

export function addPendingScreenshot(appId: string, path: string) {
  if (pending?.appId !== appId) pending = { appId, paths: [] };
  if (!pending.paths.includes(path)) pending = { appId, paths: [...pending.paths, path] };
  comboUntil = Date.now() + COMBO_WINDOW_MS;
  emit();
}

export function clearPendingScreenshots() {
  pending = null;
  comboUntil = 0;
  emit();
}

/** Whether RB + A should attach the screenshots just taken. */
export function screenshotComboArmed(): boolean {
  return !!pending && Date.now() < comboUntil;
}

export function getPendingScreenshots() {
  return pending;
}

export function usePendingScreenshots(): PendingShots | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => pending
  );
}
