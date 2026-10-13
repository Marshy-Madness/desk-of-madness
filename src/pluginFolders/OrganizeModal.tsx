import { FC, ReactNode } from "react";
import { DialogButton, Focusable, Menu, MenuItem, ModalRoot, showContextMenu, showModal, ToggleField } from "@decky/ui";
import { FaArrowDown, FaArrowUp } from "react-icons/fa";
import { NameModal } from "../components/NameModal";
import * as s from "../components/styles";
import { useSettings } from "../state/notesStore";
import { Hint } from "../tomes/bits";
import { PluginFolder } from "../types";
import {
  addFolder,
  changeFolder,
  DeckyPlugin,
  movePluginTo,
  removeFolder,
  savePluginFolders,
  shiftInFolder,
  shiftTop,
  topLevel,
  useDeckyList,
} from "./decky";

const FOLDER_ICONS = ["📁", "🎮", "🛠️", "🎨", "🔊", "⚡", "📊", "🌐", "🧩", "⭐", "🔒", "🧪", "📚", "🕹️", "💬", "🗂️"];

const small = { ...s.smallButton, minWidth: 0, width: "auto", padding: "4px 9px", fontSize: "12px" };

const Small: FC<{ onClick: (e: any) => void; children: ReactNode; label?: string; disabled?: boolean }> = ({ onClick, children, label, disabled }) => (
  <DialogButton style={small} onClick={onClick} onOKActionDescription={label} disabled={disabled}>
    {children}
  </DialogButton>
);

const Row: FC<{ icon: ReactNode; name: ReactNode; indent?: boolean; children: ReactNode }> = ({ icon, name, indent, children }) => (
  <Focusable flow-children="row" style={{ ...s.row, padding: "6px 10px", marginBottom: "4px", marginLeft: indent ? "24px" : 0 }}>
    <span style={{ width: "20px", display: "flex", justifyContent: "center", flex: "0 0 auto" }}>{icon}</span>
    <div style={{ flex: 1, minWidth: 0, ...s.title, fontWeight: indent ? "normal" : "bold" }}>{name}</div>
    <div style={{ display: "flex", gap: "4px", flex: "0 0 auto" }}>{children}</div>
  </Focusable>
);

/** Make, rename and fill folders, and put the list in order. Changes save straight away. */
export const OrganizeModal: FC<{ closeModal?: () => void }> = ({ closeModal }) => {
  const settings = useSettings();
  const st = useDeckyList();
  const cfg = settings.pluginFolders ?? {};
  const folders = cfg.folders ?? [];
  if (!st) {
    return (
      <ModalRoot className="dom-modal" onCancel={closeModal}>
        <h3 style={{ marginTop: 0 }}>Plugin folders</h3>
        <Hint>Couldn't read Decky's plugin list.</Hint>
      </ModalRoot>
    );
  }
  const items = topLevel(st, cfg);

  const moveMenu = (p: DeckyPlugin, e: any, current: string | null) =>
    showContextMenu(
      <Menu label={`Move ${p.name} to…`}>
        {current && <MenuItem onSelected={() => movePluginTo(p.name, null)}>No folder (top level)</MenuItem>}
        {folders
          .filter((f) => f.id !== current)
          .map((f) => (
            <MenuItem key={f.id} onSelected={() => movePluginTo(p.name, f.id)}>
              {f.icon} {f.name}
            </MenuItem>
          ))}
        <MenuItem
          onSelected={() =>
            showModal(<NameModal heading="New folder" onSubmit={(name) => movePluginTo(p.name, addFolder(name.slice(0, 32)).id)} />)
          }
        >
          ＋ New folder…
        </MenuItem>
      </Menu>,
      e?.currentTarget ?? window
    );

  const iconMenu = (f: PluginFolder, e: any) =>
    showContextMenu(
      <Menu label="Folder icon">
        {FOLDER_ICONS.map((icon) => (
          <MenuItem key={icon} onSelected={() => changeFolder(f.id, { icon })}>
            {icon}
          </MenuItem>
        ))}
      </Menu>,
      e?.currentTarget ?? window
    );

  const folderMenu = (f: PluginFolder, e: any) =>
    showContextMenu(
      <Menu label={f.name}>
        <MenuItem onSelected={() => showModal(<NameModal heading="Folder name" initial={f.name} onSubmit={(name) => changeFolder(f.id, { name: name.slice(0, 32) })} />)}>
          Rename…
        </MenuItem>
        <MenuItem onSelected={() => iconMenu(f, e)}>Change icon…</MenuItem>
        <MenuItem tone="destructive" onSelected={() => removeFolder(f.id)}>
          Delete folder (its plugins go back to the top level)
        </MenuItem>
      </Menu>,
      e?.currentTarget ?? window
    );

  const upDown = (onMove: (by: -1 | 1) => void, i: number, count: number) => (
    <>
      <Small onClick={() => onMove(-1)} label="Move up" disabled={i === 0}>
        <FaArrowUp size={10} />
      </Small>
      <Small onClick={() => onMove(1)} label="Move down" disabled={i === count - 1}>
        <FaArrowDown size={10} />
      </Small>
    </>
  );

  return (
    <ModalRoot className="dom-modal" onCancel={closeModal}>
      <h3 style={{ marginTop: 0, marginBottom: "4px" }}>Plugin folders</h3>
      <ToggleField
        label="Folders in Decky's list"
        description="Show these folders in Decky's own Quick Access list too, instead of its flat list. Off: only the Plugin Folders Tome uses them."
        checked={cfg.inDeckyList ?? false}
        onChange={(v) => savePluginFolders({ inDeckyList: v })}
      />
      <Focusable flow-children="row" style={{ display: "flex", gap: "6px", margin: "8px 0" }}>
        <DialogButton style={{ ...s.primaryButton, minWidth: 0, width: "auto" }} onClick={() => showModal(<NameModal heading="New folder" onSubmit={(name) => addFolder(name.slice(0, 32))} />)}>
          ＋ New folder
        </DialogButton>
        <DialogButton style={{ ...s.smallButton, minWidth: 0, width: "auto" }} onClick={closeModal}>
          Done
        </DialogButton>
      </Focusable>
      <Hint>Plugins hidden in Decky's settings don't show here. Changes save straight away.</Hint>
      <div style={{ marginTop: "8px" }}>
        {items.map((it, i) => {
          const moveTop = (by: -1 | 1) => shiftTop(items, it.key, by);
          if (it.kind === "plugin") {
            const p = it.plugin;
            return (
              <Row key={it.key} icon={p.icon} name={p.name}>
                {upDown(moveTop, i, items.length)}
                <Small onClick={(e) => moveMenu(p, e, null)} label="Move to a folder">
                  Folder…
                </Small>
              </Row>
            );
          }
          const f = it.folder;
          return (
            <div key={it.key}>
              <Row icon={f.icon} name={f.name}>
                {upDown(moveTop, i, items.length)}
                <Small onClick={(e) => folderMenu(f, e)} label="Rename, icon, delete">
                  ⋯
                </Small>
              </Row>
              {it.plugins.map((p, j) => (
                <Row key={p.name} icon={p.icon} name={p.name} indent>
                  {upDown((by) => shiftInFolder(f.id, it.plugins.map((x) => x.name), p.name, by), j, it.plugins.length)}
                  <Small onClick={(e) => moveMenu(p, e, f.id)} label="Move to another folder">
                    Move…
                  </Small>
                </Row>
              ))}
              {!it.plugins.length && (
                <div style={{ marginLeft: "24px", marginBottom: "6px" }}>
                  <Hint>Empty: use Folder… on a plugin to put it here.</Hint>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </ModalRoot>
  );
};
