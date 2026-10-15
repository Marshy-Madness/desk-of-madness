import { FC } from "react";
import { DialogButton, Focusable, ModalRoot, showModal } from "@decky/ui";
import { toaster } from "@decky/api";
import { FaPlus } from "react-icons/fa";
import { backend } from "../api/backend";
import { closeNotesPage } from "../opening";
import { openEditor, openNote, recentlyOpened } from "../noteActions";
import { whenNoteWindowsClose } from "../state/resume";
import { getSettings } from "../state/notesStore";
import { NoteItem } from "../components/NoteItem";
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
  // Full-width rows and cards: the shared button style centres each button at its own width, which in a
  // column made a ragged stack of pills.
  const wide = { ...s.smallButton, alignSelf: "stretch", flex: 1, justifyContent: "center" };
  return (
    <ModalRoot className="dom-modal" onCancel={leave}>
      <Focusable flow-children="row" style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "10px" }}>
        <h2 style={{ margin: 0, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {game.name}
        </h2>
        <DialogButton style={s.primaryButton} onClick={then(() => openEditor(game, null))}>
          <FaPlus size={12} /> New note
        </DialogButton>
      </Focusable>
      <Focusable
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          gap: "8px",
          maxHeight: "55vh",
          overflowY: "auto",
          padding: "2px",
        }}
      >
        {notes.map((n) => (
          <NoteItem key={n.id} appId={game.appId} note={n} onOpen={then(() => openNote(game, n))} onOptions={then(() => openNote(game, n))} />
        ))}
      </Focusable>
      {!notes.length && <div style={{ fontSize: "14px", opacity: 0.75, padding: "16px 0", textAlign: "center" }}>No notes for this game yet.</div>}
      <Focusable flow-children="row" style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
        <DialogButton style={wide} onClick={then(onFullPage)}>
          Full notes page
        </DialogButton>
        <DialogButton style={wide} onClick={leave}>
          Close
        </DialogButton>
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
