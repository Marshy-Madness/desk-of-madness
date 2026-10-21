import { FC, useEffect, useRef, useState } from "react";
import { DialogButton, Field, Focusable, ModalRoot, showModal } from "@decky/ui";
import { toaster } from "@decky/api";
import {
  Button,
  cancelRecordingCombo,
  ComboKind,
  comboLabel,
  DEFAULT_COMBOS,
  getCombo,
  getKeys,
  keysLabel,
  MAX_COMBO,
  startRecordingCombo,
  usableCombo,
  usableKeys,
  useComboRecording,
} from "../combos";
import { backend } from "../api/backend";
import { getSettings, updateSettings, useSettings } from "../state/notesStore";
import { ComboAction } from "../types";
import { COMMANDS } from "../voice";
import * as s from "./styles";

const ACTION_NAMES: Record<ComboAction, string> = {
  radial: "Radial menu",
  commands: "Desk Commands",
  open: "Notes",
  quicknote: "Quick note",
  desk: "Desk",
  web: "Web Browser",
  achievements: "Achievements",
  dictate: "Speech to text",
  voice: "Voice command",
};

const IDLE_CANCEL_MS = 10_000;
const swallow = () => {}; // a handler that doesn't return false keeps the button from reaching Steam's menus

/** Hold the new combo (or keys), let go, done. Buttons and shortcuts don't do anything else while this is open. */
const RecordComboModal: FC<{ action: ComboAction; kind: ComboKind; closeModal?: () => void }> = ({ action, kind, closeModal }) => {
  const { preview } = useComboRecording();
  const idle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const keys = kind === "keys";
  const label = (combo: string[] | null) => (keys ? keysLabel(combo) : comboLabel(combo as Button[] | null));
  const [keyboard, setKeyboard] = useState<{ devices: number; error: string | null } | null>(null);

  useEffect(() => {
    if (keys) backend.keyboardStatus().then(setKeyboard).catch(() => {});
    startRecordingCombo(action, kind, (combo) => {
      const current = (other: ComboAction) => (keys ? getKeys(other) : getCombo(other));
      const clash = (Object.keys(ACTION_NAMES) as ComboAction[]).find(
        (other) => other !== action && label(current(other)) === label(combo)
      );
      if (keys && !usableKeys(combo)) {
        toaster.toast({
          title: "Pick another shortcut",
          body: `${label(combo)} would fire while you type. Hold Ctrl, Alt or Super with another key, or use an F-key.`,
        });
      } else if (!keys && !usableCombo(combo as Button[])) {
        toaster.toast({
          title: "Pick another combo",
          body: `${label(combo)} on its own is needed for Steam's menus. Hold two buttons, or use a back button (L4, R4, L5, R5).`,
        });
      } else if (clash) {
        toaster.toast({ title: keys ? "Shortcut already used" : "Combo already used", body: `${label(combo)} is the ${ACTION_NAMES[clash]} ${keys ? "shortcut" : "combo"}.` });
      } else {
        (keys ? saveKeys : save)(action, combo);
        toaster.toast({ title: `${ACTION_NAMES[action]} ${keys ? "shortcut" : "combo"}`, body: label(combo), duration: 3000 });
      }
      closeModal?.();
    });
    return () => {
      clearTimeout(idle.current);
      cancelRecordingCombo();
    };
  }, []);

  // Nothing pressed for a while: give up, keeping the old combo.
  useEffect(() => {
    clearTimeout(idle.current);
    idle.current = setTimeout(() => closeModal?.(), IDLE_CANCEL_MS);
  }, [preview]);

  return (
    <ModalRoot className="dom-modal" onCancel={swallow} bAllowFullSize={false}>
      <Focusable
        noFocusRing
        onOKButton={swallow}
        onCancelButton={swallow}
        onSecondaryButton={swallow}
        onOptionsButton={swallow}
        onMenuButton={swallow}
        onGamepadDirection={swallow}
        style={{ textAlign: "center", padding: "8px 0" }}
      >
        <h2 style={{ margin: "0 0 8px" }}>
          New {ACTION_NAMES[action]} {keys ? "keyboard shortcut" : "combo"}
        </h2>
        <div style={{ fontSize: "14px", opacity: 0.8 }}>
          Hold up to {MAX_COMBO} {keys ? "keys" : "buttons"} together, then let go.
        </div>
        <div style={{ fontSize: "22px", fontWeight: "bold", margin: "18px 0", minHeight: "30px" }}>
          {preview.length ? label(preview) : keys ? "Waiting for keys…" : "Waiting for buttons…"}
        </div>
        <div style={{ fontSize: "12px", opacity: 0.65 }}>
          {keys
            ? "Use Ctrl, Alt or Super with another key (or an F-key), so typing doesn't set it off. "
            : "STEAM and ··· still open Steam's menus if pressed first, so hold another button before them. "}
          Nothing pressed for 10 seconds cancels.
        </div>
        {keys && keyboard && !keyboard.devices && (
          <div style={{ fontSize: "12px", color: "#ffb74d", marginTop: "8px" }}>
            {keyboard.error ?? "No keyboard found"}. Keys still work while Steam's own screens are in front, but not in a game.
          </div>
        )}
      </Focusable>
      <DialogButton style={{ ...s.smallButton, marginTop: "12px" }} onClick={() => closeModal?.()}>
        Cancel
      </DialogButton>
    </ModalRoot>
  );
};

function save(action: ComboAction, combo: string[]) {
  return updateSettings({ combos: { ...getSettings().combos, [action]: combo } });
}

function saveKeys(action: ComboAction, keys: string[]) {
  return updateSettings({ keys: { ...getSettings().keys, [action]: keys } });
}

/** One combo: what it is now, and buttons to change it, put it back, or turn it off; the same for its keyboard shortcut. */
export const ComboRow: FC<{ action: ComboAction; label: string; description: string; canTurnOff?: boolean; disabled?: boolean }> = ({
  action,
  label,
  description,
  canTurnOff,
  disabled,
}) => {
  useSettings(); // re-render when the combo changes
  const combo = getCombo(action);
  const keys = getKeys(action);
  const isDefault = comboLabel(combo) === comboLabel(DEFAULT_COMBOS[action]);
  return (
    <Field label={label} description={description} childrenLayout="below" disabled={disabled}>
      <Focusable style={s.toolbar} flow-children="row">
        <div style={{ fontWeight: "bold", fontSize: "15px", marginRight: "6px" }}>{comboLabel(combo)}</div>
        <DialogButton style={s.smallButton} disabled={disabled} onClick={() => showModal(<RecordComboModal action={action} kind="buttons" />)}>
          Change
        </DialogButton>
        {!isDefault && (
          <DialogButton style={s.smallButton} disabled={disabled} onClick={() => save(action, DEFAULT_COMBOS[action])}>
            Default
          </DialogButton>
        )}
        {canTurnOff && combo && (
          <DialogButton style={s.smallButton} disabled={disabled} onClick={() => save(action, [])}>
            Turn off
          </DialogButton>
        )}
      </Focusable>
      <Focusable style={{ ...s.toolbar, marginTop: "6px" }} flow-children="row">
        <div style={{ fontSize: "13px", opacity: 0.75, marginRight: "6px" }}>
          Keyboard: <b>{keys ? keysLabel(keys) : "none"}</b>
        </div>
        <DialogButton style={s.smallButton} disabled={disabled} onClick={() => showModal(<RecordComboModal action={action} kind="keys" />)}>
          {keys ? "Change" : "Set"}
        </DialogButton>
        {keys && (
          <DialogButton style={s.smallButton} disabled={disabled} onClick={() => saveKeys(action, [])}>
            Remove
          </DialogButton>
        )}
      </Focusable>
    </Field>
  );
};

/** Every voice command, for the Settings page. */
export const VoiceCommandList: FC = () => (
  <Focusable style={{ fontSize: "13px", padding: "4px 0" }}>
    {COMMANDS.map((c) => (
      <Focusable key={c.usage} onActivate={() => {}} style={{ padding: "4px 0", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <div style={{ fontWeight: "bold" }}>“{c.usage}”</div>
        <div style={{ opacity: 0.75 }}>{c.does}</div>
        {c.say.length > 1 && (
          <div style={{ opacity: 0.55, fontSize: "12px" }}>
            Also: {c.say.filter((w) => w !== c.usage.split(" <")[0]).slice(0, 5).join(", ")}
          </div>
        )}
      </Focusable>
    ))}
  </Focusable>
);
