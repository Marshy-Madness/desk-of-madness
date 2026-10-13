import { FC } from "react";
import { DialogButton, Focusable, ModalRoot, showModal } from "@decky/ui";
import { toaster } from "@decky/api";
import { FaPlus, FaThumbtack } from "react-icons/fa";
import { backend } from "../api/backend";
import { closeNotesPage } from "../opening";
import { openEditor, openNote, recentlyOpened } from "../noteActions";
import { whenNoteWindowsClose } from "../state/resume";
import { getSettings } from "../state/notesStore";
import { kindInfo } from "../utils/kinds";
import { Game } from "../types";
import * as s from "../components/styles";

// Pop-ups: a note, a new note or a game's notes list in a window over the game, without the full notes page.
// They're shown by the radial page (its game picture is the background, the wheel hidden), which goes away
// again, back to the game, once the note window closes.

export type Popup = { kind: "new"; appId: string } | { kind: "list"; appId: string } | { kind: "note"; appId: string; noteId: string };

/** Whether notes open as pop-ups (Settings → Controls). */
export const popupsOn = () => (getSettings().notesIn ?? "popup") === "popup";

const MAX_LIST = 30;

/** A game's notes for a quick pick: pinned first, then the ones opened lately, then the latest edited. */
export function noteOrder(game: Game) {
  const recent = recentlyOpened(game.appId);
  const rank = (id: string) => {
    const i = recent.indexOf(id);
    return i < 0 ? recent.length : i;
  };
  return [...game.notes].sort(
    (a, b) => Number(b.pinned) - Number(a.pinned) || rank(a.id) - rank(b.id) || b.updatedAt - a.updatedAt
  );
}

const QuickNotesModal: FC<{ game: Game; onFullPage: () => void; closeModal?: () => void }> = ({ game, onFullPage, closeModal }) => {
  const notes = noteOrder(game).slice(0, MAX_LIST);
  const then = (fn: () => void) => () => {
    closeModal?.();
    fn();
  };
  const leave = () => {
    closeModal?.();
    closeNotesPage();
  };
  return (
    <ModalRoot className="dom-modal" onCancel={leave}>
      <h2 style={{ margin: "0 0 8px" }}>{game.name}</h2>
      <Focusable flow-children="column" style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
        <DialogButton style={{ ...s.primaryButton, justifyContent: "center" }} onClick={then(() => openEditor(game, null))}>
          <FaPlus size={12} style={{ marginRight: "6px" }} /> New note
        </DialogButton>
        <div style={{ maxHeight: "50vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: "4px" }}>
          {notes.map((n) => (
            <DialogButton
              key={n.id}
              style={{ ...s.smallButton, justifyContent: "flex-start", textAlign: "left", height: "auto", minHeight: "36px" }}
              onClick={then(() => openNote(game, n))}
            >
              <span style={{ marginRight: "8px", display: "inline-flex" }}>{n.pinned ? <FaThumbtack size={12} /> : kindInfo(n.kind).icon}</span>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{n.title || "Untitled"}</span>
            </DialogButton>
          ))}
          {!notes.length && <div style={{ fontSize: "13px", opacity: 0.75, padding: "6px 0" }}>No notes for this game yet.</div>}
        </div>
        <Focusable flow-children="row" style={{ display: "flex", gap: "6px", marginTop: "6px" }}>
          <DialogButton style={{ ...s.smallButton, flex: 1, justifyContent: "center" }} onClick={then(onFullPage)}>
            Full notes page
          </DialogButton>
          <DialogButton style={{ ...s.smallButton, flex: 1, justifyContent: "center" }} onClick={leave}>
            Close
          </DialogButton>
        </Focusable>
      </Focusable>
    </ModalRoot>
  );
};

/**
 * Shows a pop-up. Called by the radial page while it's showing; it puts itself away (back to the game) once
 * the note window closes. `onFullPage`: the list's button for the full notes page.
 */
export async function runPopup(p: Popup, onFullPage: (appId: string) => void) {
  whenNoteWindowsClose(closeNotesPage);
  let game: Game;
  try {
    game = await backend.getGame(p.appId);
  } catch (e) {
    toaster.toast({ title: "Desk of Madness", body: "Couldn't load this game's notes." });
    return closeNotesPage();
  }
  if (p.kind === "new") return openEditor(game, null);
  if (p.kind === "note") {
    const note = game.notes.find((n) => n.id === p.noteId);
    if (note) return openNote(game, note);
    toaster.toast({ title: "Desk of Madness", body: "That note isn't there any more." });
  }
  showModal(<QuickNotesModal game={game} onFullPage={() => onFullPage(game.appId)} />);
}
