import { backend } from "./api/backend";
import { toaster } from "@decky/api";
import { getSettings, loadSettings, updateSettings } from "./state/notesStore";

// Opens the Madness Notes desktop app (the Linux AppImage) from Desk of Madness. Gaming mode only shows apps
// Steam started, so the app gets a non-Steam shortcut and is launched through Steam with a vaultnotes:// link.

const SHORTCUT_NAME = "Madness Notes";

const steam = (): any => (window as any).SteamClient;

/** `vaultnotes://search?q=…` or `vaultnotes://open?path=…`, as the app's deep-link parser expects. */
export function notesLink(opts: { search?: string; path?: string } = {}): string {
  if (opts.path) return `vaultnotes://open?path=${encodeURIComponent(opts.path)}`;
  if (opts.search) return `vaultnotes://search?q=${encodeURIComponent(opts.search)}`;
  return "";
}

export async function findNotesApp(): Promise<string> {
  const saved = getSettings().notesAppPath;
  if (saved && (await backend.fileExists(saved))) return saved;
  const found = await backend.findNotesApp();
  if (found) await updateSettings({ notesAppPath: found });
  return found;
}

/** Starts Madness Notes (through a Steam shortcut). Returns an error message, or "" when it launched. */
export async function openMadnessNotes(link = ""): Promise<string> {
  const apps = steam()?.Apps;
  if (!apps?.AddShortcut || !apps?.RunGame) return "Steam's shortcut API isn't available here.";
  const exe = await findNotesApp();
  if (!exe) return "Madness Notes isn't installed on this Deck. Put its .AppImage in Downloads or Applications, or set the path in settings.";

  let id = getSettings().notesShortcutId;
  const overview = id ? (window as any).appStore?.GetAppOverviewByAppID?.(id) : null;
  if (!id || !overview) {
    id = Number(await apps.AddShortcut(SHORTCUT_NAME, exe, exe.slice(0, exe.lastIndexOf("/")), link));
    if (!id) return "Steam wouldn't add the shortcut.";
    await updateSettings({ notesShortcutId: id });
    await new Promise((r) => setTimeout(r, 500));
  }
  if (getSettings().notesHideShortcut) apps.SetAppHidden?.(id, true);
  await backend.prepareNotesApp(exe);
  apps.SetShortcutExe?.(id, exe);
  apps.SetShortcutLaunchOptions?.(id, link);

  const gameId = (window as any).appStore?.GetAppOverviewByAppID?.(id)?.m_gameid ?? String(id);
  apps.RunGame(String(gameId), "", -1, 100);
  return "";
}

/** Once per new version: tells the user a newer Madness Notes build is on their server. Quiet when anything fails. */
export async function checkNotesUpdateOnStart() {
  try {
    await loadSettings();
    const path = getSettings().notesAppPath;
    if (!path || !(await backend.fileExists(path))) return;
    const c = await backend.notesAppCheck(getSettings().notesServerUrl ?? "", path);
    if (c.newer && c.latest && c.latest !== getSettings().notesUpdateSeen) {
      await updateSettings({ notesUpdateSeen: c.latest });
      toaster.toast({
        title: "Madness Notes",
        body: `Version ${c.latest} is available. Update it in Desk of Madness settings.`,
        duration: 8000,
      });
    }
  } catch {
    // offline or server without builds: nothing to say
  }
}
