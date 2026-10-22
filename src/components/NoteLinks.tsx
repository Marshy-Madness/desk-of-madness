import { FC, useEffect, useState } from "react";
import { DialogButton, Focusable, ModalRoot, Spinner, TextField, showModal } from "@decky/ui";
import { FaBook, FaExternalLinkAlt, FaLink, FaPlus, FaTrash } from "react-icons/fa";
import { toaster } from "@decky/api";
import { backend } from "../api/backend";
import { LinkSource, openLink, toUrl } from "../browser";
import { Game, Note, NoteHit, NoteRef, NoteSource } from "../types";
import { newId } from "../utils/format";
import { kindInfo } from "../utils/kinds";
import { openWorkshopEntry } from "../scrolls/hooks";
import * as s from "./styles";

// A note's References (other notes and guides, or Workshop posts) and Sources (web pages with a title),
// shown under the note when reading it and edited in the note editor.

// noteActions registers how to open a note, so this file doesn't import it (it imports the viewer, which imports this).
let noteOpener: ((game: Game, note: Note) => void) | null = null;
export const setNoteOpener = (fn: (game: Game, note: Note) => void) => (noteOpener = fn);

export const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

/** Sources with no address aren't worth saving; a missing title becomes the site's name. */
export const keepSources = (sources: NoteSource[]): NoteSource[] =>
  sources
    .filter((x) => x.url.trim())
    .map((x) => ({ ...x, url: toUrl(x.url), title: x.title.trim() || hostOf(toUrl(x.url)) }));

async function openRef(ref: NoteRef, fallbackAppId: string, beforeOpen?: () => void) {
  if (ref.workshopId) {
    openWorkshopEntry(ref.workshopId, ref.appId ?? fallbackAppId);
    return;
  }
  try {
    const game = await backend.getGame(ref.appId ?? fallbackAppId);
    const note = game.notes.find((n) => n.id === ref.noteId);
    if (!note) throw new Error(`“${ref.title}” isn't in your notes any more.`);
    beforeOpen?.();
    noteOpener?.(game, note);
  } catch (e) {
    toaster.toast({ title: "Couldn't open it", body: e instanceof Error ? e.message : String(e) });
  }
}

const label = { margin: "12px 0 4px", fontSize: "13px", opacity: 0.8 } as const;

/** References and sources when reading a note. */
export const LinksView: FC<{
  appId: string;
  refs?: NoteRef[];
  sources?: NoteSource[];
  /** The note being read, for the browser's "Add this page to the note". */
  from?: LinkSource;
  /** Closes the window this is shown in, before something else opens. */
  beforeOpen?: () => void;
}> = ({ appId, refs, sources, from, beforeOpen }) => {
  if (!refs?.length && !sources?.length) return null;
  return (
    <>
      {!!refs?.length && (
        <Focusable style={{ marginBottom: "8px" }}>
          <div style={label}>References</div>
          {refs.map((r) => (
            <Focusable
              key={r.id}
              style={{ ...s.row, padding: "6px 10px", marginBottom: "4px" }}
              onActivate={() => openRef(r, appId, beforeOpen)}
              onClick={() => openRef(r, appId, beforeOpen)}
              onOKActionDescription="Open"
            >
              {r.workshopId ? <FaBook size={12} /> : <FaLink size={12} />}
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.title || "Untitled"}</span>
              {r.workshopId && <span style={{ fontSize: "12px", opacity: 0.7 }}>Workshop</span>}
            </Focusable>
          ))}
        </Focusable>
      )}
      {!!sources?.length && (
        <Focusable style={{ marginBottom: "8px" }}>
          <div style={label}>Sources</div>
          {sources.map((x) => (
            <Focusable
              key={x.id}
              style={{ ...s.row, padding: "6px 10px", marginBottom: "4px" }}
              onActivate={() => {
                beforeOpen?.();
                openLink(x.url, from);
              }}
              onClick={() => {
                beforeOpen?.();
                openLink(x.url, from);
              }}
              onOKActionDescription="Open link"
            >
              <FaExternalLinkAlt size={11} />
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#59bfff" }}>{x.title}</span>
              <span style={{ fontSize: "12px", opacity: 0.6 }}>{hostOf(x.url)}</span>
            </Focusable>
          ))}
        </Focusable>
      )}
    </>
  );
};

/** Pick one of your notes or guides to point to: this game's notes, or search every game. */
const RefPicker: FC<{ appId: string; exclude: string[]; onPick: (ref: NoteRef) => void; closeModal?: () => void }> = ({
  appId,
  exclude,
  onPick,
  closeModal,
}) => {
  const [q, setQ] = useState("");
  const [here, setHere] = useState<Note[] | null>(null);
  const [hits, setHits] = useState<NoteHit[] | null>(null);

  useEffect(() => {
    backend.getGame(appId).then((g) => setHere([...g.notes].sort((a, b) => b.updatedAt - a.updatedAt))).catch(() => setHere([]));
  }, [appId]);
  useEffect(() => {
    if (!q.trim()) return setHits(null);
    const t = setTimeout(() => backend.searchNotes(q, 40).then(setHits).catch(() => setHits([])), 250);
    return () => clearTimeout(t);
  }, [q]);

  const pick = (ref: NoteRef) => {
    onPick(ref);
    closeModal?.();
  };
  const rows: { appId: string; id: string; title: string; kind?: Note["kind"]; game?: string }[] = q.trim()
    ? (hits ?? []).map((h) => ({ appId: h.appId, id: h.id, title: h.title, kind: h.kind, game: h.appId === appId ? undefined : h.gameName }))
    : (here ?? []).map((n) => ({ appId, id: n.id, title: n.title, kind: n.kind }));

  return (
    <ModalRoot className="dom-modal" onCancel={closeModal}>
      <h3 style={{ marginTop: 0 }}>Add a reference</h3>
      <TextField label="Search all your notes and guides" value={q} onChange={(e) => setQ(e.target.value)} />
      <Focusable style={{ maxHeight: "50vh", overflowY: "auto", marginTop: "8px" }}>
        {(q.trim() ? hits : here) === null && <Spinner style={{ width: "28px" }} />}
        {rows
          .filter((r) => !exclude.includes(r.id))
          .map((r) => (
            <Focusable
              key={`${r.appId}/${r.id}`}
              style={{ ...s.row, padding: "6px 10px", marginBottom: "4px" }}
              onActivate={() => pick({ id: newId(), title: r.title, appId: r.appId, noteId: r.id })}
              onClick={() => pick({ id: newId(), title: r.title, appId: r.appId, noteId: r.id })}
              onOKActionDescription="Add"
            >
              <span>{kindInfo(r.kind).icon}</span>
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.title || "Untitled"}</span>
              {r.game && <span style={{ fontSize: "12px", opacity: 0.7 }}>{r.game}</span>}
            </Focusable>
          ))}
        {rows.length === 0 && (q.trim() ? hits : here) !== null && <div style={{ opacity: 0.6 }}>Nothing found.</div>}
      </Focusable>
      <DialogButton style={{ marginTop: "10px" }} onClick={closeModal}>
        Cancel
      </DialogButton>
    </ModalRoot>
  );
};

/** References and sources in the note editor. */
export const LinksEditor: FC<{
  appId: string;
  noteId?: string;
  refs: NoteRef[];
  sources: NoteSource[];
  onRefs: (refs: NoteRef[]) => void;
  onSources: (sources: NoteSource[]) => void;
}> = ({ appId, noteId, refs, sources, onRefs, onSources }) => {
  const setSource = (id: string, patch: Partial<NoteSource>) => onSources(sources.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  return (
    <>
      <div style={label}>References (notes and guides this one points to)</div>
      {refs.map((r) => (
        <Focusable key={r.id} style={{ ...s.toolbar, marginBottom: "4px" }}>
          {r.workshopId ? <FaBook size={12} /> : <FaLink size={12} />}
          <div style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {r.title || "Untitled"}
            {r.workshopId && <span style={{ fontSize: "12px", opacity: 0.6 }}> · Workshop</span>}
          </div>
          <DialogButton style={s.smallButton} onClick={() => onRefs(refs.filter((x) => x.id !== r.id))}>
            <FaTrash size={11} />
          </DialogButton>
        </Focusable>
      ))}
      <Focusable style={s.toolbar}>
        <DialogButton
          style={s.smallButton}
          onClick={() =>
            showModal(
              <RefPicker
                appId={appId}
                exclude={[...(noteId ? [noteId] : []), ...refs.map((r) => r.noteId ?? "")]}
                onPick={(ref) => onRefs([...refs, ref])}
              />
            )
          }
        >
          <FaPlus /> Add reference
        </DialogButton>
      </Focusable>

      <div style={label}>Sources (web pages, with a title you choose)</div>
      {sources.map((x) => (
        <Focusable key={x.id} style={{ ...s.toolbar, marginBottom: "4px", alignItems: "flex-end" }}>
          <div style={{ flex: 1 }}>
            <TextField label="Title" value={x.title} onChange={(e) => setSource(x.id, { title: e.target.value })} />
          </div>
          <div style={{ flex: 2 }}>
            <TextField label="Link" value={x.url} onChange={(e) => setSource(x.id, { url: e.target.value })} />
          </div>
          <DialogButton style={{ ...s.smallButton, marginBottom: "2px" }} onClick={() => onSources(sources.filter((y) => y.id !== x.id))}>
            <FaTrash size={11} />
          </DialogButton>
        </Focusable>
      ))}
      <Focusable style={s.toolbar}>
        <DialogButton style={s.smallButton} onClick={() => onSources([...sources, { id: newId(), title: "", url: "" }])}>
          <FaPlus /> Add source
        </DialogButton>
      </Focusable>
    </>
  );
};
