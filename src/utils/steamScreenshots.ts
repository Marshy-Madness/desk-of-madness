/**
 * Deletes screenshots from Steam's own library (and disk) using Steam's API, so its screenshot
 * index stays consistent. Used after a screenshot has been copied into a note.
 */
export function removeFromSteam(appId: string, paths: string[]): Promise<number> {
  // Steam's screenshot calls can go unanswered; don't let that hold up attaching (the copy is already made).
  const timeout = new Promise<number>((_, reject) => setTimeout(() => reject(new Error("Steam didn't answer")), 5000));
  return Promise.race([remove(appId, paths), timeout]);
}

async function remove(appId: string, paths: string[]): Promise<number> {
  const SC = (window as any).SteamClient?.Screenshots;
  if (!SC || paths.length === 0) return 0;
  const names = new Set(paths.map((p) => p.split("/").pop()));
  const all: any[] = (await SC.GetAllLocalScreenshots()) ?? [];
  const forGame = all.filter((sh) => String(sh.nAppID) === appId);
  const byGame: Record<string, number[]> = {};
  for (const sh of forGame.length ? forGame : all) {
    try {
      const path: string = await SC.GetLocalScreenshotPath(sh.nAppID, sh.hHandle);
      if (names.has(String(path).split("/").pop())) (byGame[sh.strGameID] ??= []).push(sh.hHandle);
    } catch {
      // screenshot vanished meanwhile
    }
  }
  const list = Object.entries(byGame).map(([gameID, rgHandles]) => ({ gameID, rgHandles }));
  if (list.length) await SC.DeleteLocalScreenshots(list);
  return list.reduce((n, x) => n + x.rgHandles.length, 0);
}

// Steam's own "screenshot saved" popup is the client setting enable_screenshot_notification (field 4006 of
// CMsgClientSettings). Steam's settings page writes it as a one-field message, so we do the same:
// key (4006 << 3, as a varint) then the bool.
const NOTIFY_FIELD_KEY = [0xb0, 0xfa, 0x01];

/** Whether Steam shows its own popup when you take a screenshot (null if Steam doesn't say). */
export function steamScreenshotPopupOn(): boolean | null {
  const v = (window as any).settingsStore?.clientSettings?.enable_screenshot_notification;
  return typeof v === "boolean" ? v : null;
}

/** Turns Steam's own screenshot popup on or off (the same switch as Settings → In Game in Steam). */
export function setSteamScreenshotPopup(on: boolean): boolean {
  const set = (window as any).SteamClient?.Settings?.SetSetting;
  if (typeof set !== "function") return false;
  set(btoa(String.fromCharCode(...NOTIFY_FIELD_KEY, on ? 1 : 0)));
  return true;
}
