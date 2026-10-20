import { addEventListener, removeEventListener } from "@decky/api";
import { backend } from "./api/backend";
import { openInNewTab } from "./browser";
import { WEB_ROUTE } from "./state/place";
import { getSettings, onSettingsChange } from "./state/notesStore";
import { currentPath, steamHistory } from "./steamWindow";

// Games picked in Steam's store open in a new tab of our browser, so the store stays where it was (a long tag
// search is otherwise lost when you go back). The backend (py_modules/storelinks.py) puts a script in the
// store's pages that catches those clicks; here we say when it should (the store or our browser is on screen
// and the setting is on), and open what it catches.

const STORE_ROUTES = ["/steamweb", "/store"]; // Steam's store page in the Gamepad UI

export function startStoreLinks(): () => void {
  let sent: boolean | null = null;

  const update = () => {
    const path = currentPath();
    const on =
      getSettings().storeLinksInBrowser !== false &&
      (STORE_ROUTES.some((r) => path.startsWith(r)) || path.startsWith(WEB_ROUTE));
    if (on === sent) return;
    sent = on;
    backend.storeLinks(on).catch((e) => console.warn("Desk of Madness: store links", e));
  };

  const onLink = (url: string) => {
    if (sent) openInNewTab(url, "full");
  };
  addEventListener("store_link", onLink);

  // Steam's window may not be ready this early; check every second until it is, then follow its address.
  let unlisten: (() => void) | undefined;
  const hook = () => {
    const h = steamHistory();
    if (!h) return false;
    unlisten = h.listen(update);
    return true;
  };
  const timer = hook() ? undefined : setInterval(() => hook() && clearInterval(timer), 1000);
  const unSettings = onSettingsChange(update);
  update();

  return () => {
    clearInterval(timer);
    unlisten?.();
    unSettings();
    removeEventListener("store_link", onLink);
    backend.storeLinks(false).catch(() => {});
  };
}
