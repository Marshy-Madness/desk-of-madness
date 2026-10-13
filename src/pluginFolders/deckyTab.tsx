import { cloneElement, FC, isValidElement, ReactElement, ReactNode } from "react";
import { QuickAccessTab } from "@decky/ui";
import { onQamTabs } from "../scrolls/hooks";
import { useSettings } from "../state/notesStore";
import { useDeckyList } from "./decky";
import { DeckyFolderList } from "./FolderList";

// Folders in Decky's own Quick Access list. Decky's tab panel is
//   <ErrorBoundary><QuickAccessVisibleStateProvider tab>{<DeckyStateContextProvider><PluginView/>…}</…></…>
// and we swap only the innermost part for a switch: our folder list while no plugin is open and the setting is
// on, Decky's PluginView otherwise. The visibility provider stays mounted, so plugins still learn when the
// menu opens and closes.

/** Ours or Decky's list. */
const Switch: FC<{ decky: ReactNode }> = ({ decky }) => {
  const settings = useSettings();
  const st = useDeckyList();
  if (!settings.pluginFolders?.inDeckyList || !st || st.activePlugin) return <>{decky}</>;
  return <DeckyFolderList />;
};

const MARK = "__domFolders";

/** Starts drawing folders in Decky's tab (when turned on). Returns a cleanup that puts Decky's panel back. */
export function startDeckyTabFolders(): () => void {
  const changed = new Map<any, ReactElement>();
  const stop = onQamTabs((tabs) => {
    const tab = tabs.find((t) => t?.key === QuickAccessTab.Decky);
    if (!tab || tab[MARK]) return;
    const panel = tab.panel;
    const provider = panel?.props?.children;
    // Only when Decky's panel looks as expected; otherwise leave Decky's list alone (the Tome still works).
    if (!isValidElement(panel) || !isValidElement(provider) || !(provider.props as any)?.tab) return;
    const content = (provider.props as any).children;
    tab[MARK] = true;
    changed.set(tab, panel);
    tab.panel = cloneElement(panel as ReactElement<any>, {}, cloneElement(provider as ReactElement<any>, {}, <Switch decky={content} />));
  });
  return () => {
    stop();
    for (const [tab, panel] of changed) {
      tab.panel = panel;
      delete tab[MARK];
    }
  };
}
