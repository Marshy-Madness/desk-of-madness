import { ReactElement, useEffect, useState } from "react";
import { Navigation, QuickAccessTab } from "@decky/ui";
import { getSettings, updateSettings } from "../state/notesStore";
import { PluginFolder, PluginFolderSettings } from "../types";
import { newId } from "../utils/format";

// Decky's plugin list, read from its own state (window.DeckyPluginLoader.deckyState: private in Decky's
// TypeScript, but there at runtime), plus our folders over it. Decky's own order, hidden plugins and
// updates are respected; folders are ours alone and only change how the list is drawn.

export interface DeckyPlugin {
  name: string;
  icon: ReactElement;
  content?: ReactElement;
}

export interface DeckyListState {
  plugins: DeckyPlugin[];
  pluginOrder: string[];
  sortPlugins: boolean;
  hiddenPlugins: string[];
  activePlugin: DeckyPlugin | null;
  updates: Map<string, unknown> | null;
}

const deckyState = (): any => (window as any).DeckyPluginLoader?.deckyState ?? null;

function read(): DeckyListState | null {
  const st = deckyState();
  try {
    return st?.publicState?.() ?? null;
  } catch {
    return null;
  }
}

/** Decky's plugin state, kept up to date; null when Decky's internals aren't where we expect. */
export function useDeckyList(): DeckyListState | null {
  const [state, setState] = useState(read);
  useEffect(() => {
    const bus: EventTarget | undefined = deckyState()?.eventBus;
    if (!bus) return;
    const l = () => setState(read());
    bus.addEventListener("update", l);
    l();
    return () => bus.removeEventListener("update", l);
  }, []);
  return state;
}

/** Plugins as Decky's list shows them: with a panel, not hidden, in Decky's order. */
export function visiblePlugins(st: DeckyListState): DeckyPlugin[] {
  return [...st.plugins]
    .sort((a, b) =>
      st.sortPlugins ? a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) : st.pluginOrder.indexOf(a.name) - st.pluginOrder.indexOf(b.name)
    )
    .filter((p) => p.content && !st.hiddenPlugins.includes(p.name));
}

export type TopItem = { kind: "folder"; key: string; folder: PluginFolder; plugins: DeckyPlugin[] } | { kind: "plugin"; key: string; plugin: DeckyPlugin };

/**
 * The list's top level: folders and the plugins in no folder, in our saved order, then anything new in
 * Decky's order. A plugin in two folders shows in both; empty folders stay (so you can fill them).
 */
export function topLevel(st: DeckyListState, cfg: PluginFolderSettings | undefined): TopItem[] {
  const plugins = visiblePlugins(st);
  const byName = new Map(plugins.map((p) => [p.name, p]));
  const folders = cfg?.folders ?? [];
  const inFolder = new Set(folders.flatMap((f) => f.plugins));
  const items: TopItem[] = [
    ...folders.map((folder) => ({
      kind: "folder" as const,
      key: `f:${folder.id}`,
      folder,
      plugins: folder.plugins.map((n) => byName.get(n)).filter((p): p is DeckyPlugin => !!p),
    })),
    ...plugins.filter((p) => !inFolder.has(p.name)).map((plugin) => ({ kind: "plugin" as const, key: `p:${plugin.name}`, plugin })),
  ];
  const order = cfg?.order ?? [];
  const rank = (key: string) => {
    const i = order.indexOf(key);
    return i < 0 ? order.length : i;
  };
  // Stable: unranked items keep folders-then-Decky's-order.
  return items.map((it, i) => ({ it, i })).sort((a, b) => rank(a.it.key) - rank(b.it.key) || a.i - b.i).map(({ it }) => it);
}

/** Opens a plugin's panel in Decky's tab, switching to that tab when we're elsewhere (own tab, full screen). */
export function openPlugin(name: string, switchTab: boolean) {
  const st = deckyState();
  if (!st) return;
  st.setActivePlugin(name);
  if (switchTab) {
    Navigation.OpenQuickAccessMenu(QuickAccessTab.Decky);
  }
}

export const pluginFolderSettings = (): PluginFolderSettings => getSettings().pluginFolders ?? {};

export function savePluginFolders(patch: Partial<PluginFolderSettings>) {
  return updateSettings({ pluginFolders: { ...pluginFolderSettings(), ...patch } });
}

export function addFolder(name: string, icon = "📁"): PluginFolder {
  const folder: PluginFolder = { id: newId(), name, icon, plugins: [] };
  savePluginFolders({ folders: [...(pluginFolderSettings().folders ?? []), folder] });
  return folder;
}

export function changeFolder(id: string, patch: Partial<PluginFolder>) {
  const folders = (pluginFolderSettings().folders ?? []).map((f) => (f.id === id ? { ...f, ...patch } : f));
  savePluginFolders({ folders });
}

export function removeFolder(id: string) {
  const cfg = pluginFolderSettings();
  savePluginFolders({ folders: (cfg.folders ?? []).filter((f) => f.id !== id), order: (cfg.order ?? []).filter((k) => k !== `f:${id}`) });
}

/** Puts a plugin in one folder (or none), taking it out of any other. */
export function movePluginTo(name: string, folderId: string | null) {
  const folders = (pluginFolderSettings().folders ?? []).map((f) => {
    const without = f.plugins.filter((n) => n !== name);
    return { ...f, plugins: f.id === folderId ? [...without, name] : without };
  });
  savePluginFolders({ folders });
}

/** Moves a plugin up or down among the folder's shown plugins (`shown`: their names in order). */
export function shiftInFolder(folderId: string, shown: string[], name: string, by: -1 | 1) {
  const i = shown.indexOf(name);
  const j = i + by;
  if (i < 0 || j < 0 || j >= shown.length) return;
  const list = [...shown];
  [list[i], list[j]] = [list[j], list[i]];
  const folders = (pluginFolderSettings().folders ?? []).map((f) =>
    // Names not shown (hidden or uninstalled plugins) keep their place at the end.
    f.id === folderId ? { ...f, plugins: [...list, ...f.plugins.filter((n) => !shown.includes(n))] } : f
  );
  savePluginFolders({ folders });
}

/** Moves a top-level item up or down; saves the whole current order so it sticks. */
export function shiftTop(items: TopItem[], key: string, by: -1 | 1) {
  const keys = items.map((it) => it.key);
  const i = keys.indexOf(key);
  const j = i + by;
  if (i < 0 || j < 0 || j >= keys.length) return;
  [keys[i], keys[j]] = [keys[j], keys[i]];
  savePluginFolders({ order: keys });
}
