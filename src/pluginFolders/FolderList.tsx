import { FC, useState } from "react";
import { ButtonItem, DialogButton, Focusable, Navigation, PanelSection, PanelSectionRow, showModal, staticClasses } from "@decky/ui";
import { BsGearFill } from "react-icons/bs";
import { FaChevronDown, FaChevronRight, FaFolderOpen, FaStore } from "react-icons/fa";
import { useSettings } from "../state/notesStore";
import { Hint, Line } from "../tomes/bits";
import { DeckyListState, DeckyPlugin, openPlugin, topLevel, useDeckyList } from "./decky";
import { OrganizeModal } from "./OrganizeModal";

// Folders stay open or shut between visits (per Deck session, not saved).
const openFolders = new Set<string>();

function useOpenFolders() {
  const [, force] = useState(0);
  return {
    isOpen: (id: string) => openFolders.has(id),
    toggle: (id: string) => {
      if (openFolders.has(id)) openFolders.delete(id);
      else openFolders.add(id);
      force((n) => n + 1);
    },
  };
}

const rowInner = { display: "flex", alignItems: "center", gap: "10px" } as const;
const iconBox = { width: "20px", display: "flex", justifyContent: "center", flex: "0 0 auto" } as const;
const badge = { width: "8px", height: "8px", borderRadius: "50%", background: "#59bf40", flex: "0 0 auto" } as const;

const hasUpdate = (st: DeckyListState, name: string) => !!st.updates?.has(name);

const titleButton = { height: "28px", width: "40px", minWidth: 0, padding: "10px 12px" } as const;

/** Decky's own Quick Access list with folders: drawn in place of Decky's flat list when that's turned on. */
export const DeckyFolderList: FC = () => {
  const settings = useSettings();
  const st = useDeckyList();
  const open = useOpenFolders();
  if (!st) return null;
  const items = topLevel(st, settings.pluginFolders);

  const pluginRow = (p: DeckyPlugin, indent: boolean) => (
    <PanelSectionRow key={p.name}>
      <ButtonItem layout="below" onClick={() => openPlugin(p.name, false)}>
        <div style={{ ...rowInner, paddingLeft: indent ? "18px" : 0 }}>
          <span style={iconBox}>{p.icon}</span>
          <div style={{ flex: 1, textAlign: "left" }}>{p.name}</div>
          {hasUpdate(st, p.name) && <span style={badge} />}
        </div>
      </ButtonItem>
    </PanelSectionRow>
  );

  return (
    <>
      {/* Decky's title bar, as Decky draws it (its own isn't exported). */}
      <Focusable style={{ display: "flex", paddingRight: "16px", position: "sticky", top: 0 }} className={staticClasses.Title}>
        <div style={{ marginRight: "auto", flex: 0.9 }}>Decky</div>
        <DialogButton
          style={titleButton}
          onClick={() => showModal(<OrganizeModal />)}
          onOKActionDescription="Organize folders"
        >
          <FaFolderOpen style={{ marginTop: "-4px", display: "block" }} />
        </DialogButton>
        <DialogButton
          style={titleButton}
          onClick={() => {
            Navigation.Navigate("/decky/store");
            Navigation.CloseSideMenus();
          }}
        >
          <FaStore style={{ marginTop: "-4px", display: "block" }} />
        </DialogButton>
        <DialogButton
          style={titleButton}
          onClick={() => {
            Navigation.Navigate("/decky/settings");
            Navigation.CloseSideMenus();
          }}
        >
          <BsGearFill style={{ marginTop: "-4px", display: "block" }} />
        </DialogButton>
      </Focusable>
      <div style={{ paddingTop: "16px" }}>
        <PanelSection>
          {items.map((it) => {
            if (it.kind === "plugin") return pluginRow(it.plugin, false);
            const { folder, plugins } = it;
            const isOpen = open.isOpen(folder.id);
            return [
              <PanelSectionRow key={it.key}>
                <ButtonItem layout="below" onClick={() => open.toggle(folder.id)}>
                  <div style={rowInner}>
                    <span style={iconBox}>{folder.icon}</span>
                    <div style={{ flex: 1, textAlign: "left" }}>{folder.name}</div>
                    {!isOpen && plugins.some((p) => hasUpdate(st, p.name)) && <span style={badge} />}
                    <span style={{ opacity: 0.6, fontSize: "12px" }}>{plugins.length}</span>
                    {isOpen ? <FaChevronDown size={12} /> : <FaChevronRight size={12} />}
                  </div>
                </ButtonItem>
              </PanelSectionRow>,
              ...(isOpen ? plugins.map((p) => pluginRow(p, true)) : []),
            ];
          })}
        </PanelSection>
      </div>
    </>
  );
};

/** The Plugin Folders Tome: the same folders, on the Desk. */
export const FolderTome: FC<{ fullScreen: boolean }> = ({ fullScreen }) => {
  const settings = useSettings();
  const st = useDeckyList();
  const open = useOpenFolders();
  if (!st) return <Hint>Couldn't read Decky's plugin list (this Decky version keeps it somewhere else).</Hint>;
  const items = topLevel(st, settings.pluginFolders);
  // From the Desk inside Decky's tab, opening a plugin swaps the panel in place; anywhere else we go there.
  const switchTab = fullScreen || !!settings.qamTab;
  const organize = () => showModal(<OrganizeModal />);
  const plugin = (p: DeckyPlugin, indent: boolean) => (
    <Line
      key={p.name}
      icon={p.icon}
      style={indent ? { marginLeft: "18px" } : undefined}
      onOpen={() => openPlugin(p.name, switchTab)}
      okLabel="Open"
      onOptions={organize}
      optionsLabel="Organize"
    >
      {p.name}
      {hasUpdate(st, p.name) && <span style={{ ...badge, display: "inline-block", marginLeft: "8px" }} />}
    </Line>
  );
  return (
    <>
      {!settings.pluginFolders?.folders?.length && <Hint>Press ☰ (or Organize) to make folders for your plugins.</Hint>}
      {items.map((it) => {
        if (it.kind === "plugin") return plugin(it.plugin, false);
        const isOpen = open.isOpen(it.folder.id);
        return (
          <div key={it.key}>
            <Line
              icon={it.folder.icon}
              onOpen={() => open.toggle(it.folder.id)}
              okLabel={isOpen ? "Close folder" : "Open folder"}
              onOptions={organize}
              optionsLabel="Organize"
            >
              <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <b style={{ flex: 1 }}>{it.folder.name}</b>
                <span style={{ opacity: 0.6, fontSize: "12px" }}>{it.plugins.length}</span>
                {isOpen ? <FaChevronDown size={11} /> : <FaChevronRight size={11} />}
              </span>
            </Line>
            {isOpen && (it.plugins.length ? it.plugins.map((p) => plugin(p, true)) : <Hint>Empty: move plugins here with Organize.</Hint>)}
          </div>
        );
      })}
      <Focusable flow-children="row" style={{ display: "flex", marginTop: "6px" }}>
        <DialogButton style={{ fontSize: "13px", padding: "5px 12px", minWidth: 0, width: "auto" }} onClick={organize}>
          📂 Organize
        </DialogButton>
      </Focusable>
    </>
  );
};
