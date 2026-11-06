import { FC, useCallback, useEffect, useState } from "react";
import { DialogButton, Focusable, ModalRoot, Spinner, TextField } from "@decky/ui";
import { backend } from "../api/backend";
import { NotesGameNote } from "../types";
import { notesLink, openMadnessNotes } from "../madnessNotes";
import { FormattedText } from "./FormattedText";

/** A game's Madness Notes note: read it, tick its checklist, add a line. Heavy editing happens in the app. */
export const VaultNoteModal: FC<{ appId: string; gameName: string; closeModal?: () => void }> = ({ appId, gameName, closeModal }) => {
  const [note, setNote] = useState<NotesGameNote | null>(null);
  const [error, setError] = useState("");
  const [line, setLine] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await backend.notesReadGame(appId, gameName);
    if (r.ok) {
      setNote(r.data);
      setError("");
    } else setError(r.error);
  }, [appId, gameName]);
  useEffect(() => {
    load();
  }, [load]);

  const run = async (p: Promise<{ ok: boolean; error?: string }>) => {
    setBusy(true);
    const r = await p;
    if (!r.ok) setError(r.error ?? "failed");
    await load();
    setBusy(false);
  };

  const add = async () => {
    if (!line.trim()) return;
    const text = line;
    setLine("");
    await run(backend.notesAppendGame(appId, gameName, text));
  };

  const body = (note?.content ?? "").replace(/^---\n[\s\S]*?\n---\n/, "");

  return (
    <ModalRoot className="dom-modal" onCancel={closeModal}>
      <h3 style={{ marginTop: 0 }}>{gameName}</h3>
      {error && <div style={{ color: "#ff8a80", marginBottom: 8 }}>{error}</div>}
      {!note && !error && <Spinner />}
      {note && (
        <>
          {note.tasks.length > 0 && (
            <Focusable style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 10 }}>
              {note.tasks.map((t) => (
                <DialogButton
                  key={t.line}
                  disabled={busy}
                  style={{ textAlign: "left", padding: "6px 10px" }}
                  onClick={() => run(backend.notesToggleTask(appId, gameName, t.line, !t.done))}
                >
                  {t.done ? "☑" : "☐"} {t.text}
                </DialogButton>
              ))}
            </Focusable>
          )}
          <div style={{ maxHeight: 220, overflowY: "auto", marginBottom: 10 }}>
            <FormattedText text={body} />
          </div>
          <TextField label="Add a line (start with [ ] for a task)" value={line} onChange={(e) => setLine(e.target.value)} />
        </>
      )}
      <Focusable style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <DialogButton onClick={add} disabled={busy || !line.trim()}>Add</DialogButton>
        <DialogButton
          onClick={async () => {
            const err = await openMadnessNotes(note ? notesLink({ path: note.path }) : "");
            if (err) setError(err);
          }}
        >
          Edit in the app
        </DialogButton>
        <DialogButton onClick={closeModal}>Close</DialogButton>
      </Focusable>
    </ModalRoot>
  );
};
