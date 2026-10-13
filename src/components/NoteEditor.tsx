import { CSSProperties, FC, Fragment, ReactNode, useEffect, useRef, useState } from "react";
import { ModalRoot, DialogButton, Dropdown, Focusable, TextField, ToggleField, showModal, ConfirmModal } from "@decky/ui";
import { FaCrop, FaCamera, FaMicrophone, FaMicrophoneAlt, FaStop, FaTrash, FaParagraph, FaPlus, FaCheckSquare, FaRegSquare, FaFileAlt,
  FaBold, FaItalic, FaUnderline, FaStrikethrough, FaHighlighter, FaCode, FaHeading, FaListUl, FaListOl, FaQuoteRight, FaMinus } from "react-icons/fa";
import { toaster } from "@decky/api";
import { backend } from "../api/backend";
import { ChecklistItem, Folder, Note, NoteKind, NoteTable, Recording, Screenshot } from "../types";
import { KINDS } from "../utils/kinds";
import { formatClock, newId } from "../utils/format";
import { useSessionTimer } from "../hooks/useSessionTimer";
import { MediaImage } from "./MediaImage";
import { EditorDraft, saveDraft } from "../state/resume";
import { AudioButton } from "./AudioButton";
import { typeInto } from "../utils/keyboard";
import { Transcripts } from "./Transcripts";
import { insertWords, useSpeechAllowed } from "../state/speech";
import { ScreenshotPicker } from "./ScreenshotPicker";
import { CropModal } from "./CropModal";
import * as s from "./styles";
import { errText } from "../utils/errors";
import { applyFormat, Format } from "../utils/markup";
import { keepTables, TablesEditor } from "./NoteTables";

const FORMATS: { fmt: Format; icon: ReactNode; label: string }[] = [
  { fmt: "bold", icon: <FaBold size={14} />, label: "Bold" },
  { fmt: "italic", icon: <FaItalic size={14} />, label: "Italic" },
  { fmt: "underline", icon: <FaUnderline size={14} />, label: "Underline" },
  { fmt: "strike", icon: <FaStrikethrough size={14} />, label: "Strike through" },
  { fmt: "mark", icon: <FaHighlighter size={14} />, label: "Highlight" },
  { fmt: "h1", icon: <FaHeading size={16} />, label: "Heading" },
  { fmt: "h2", icon: <FaHeading size={12} />, label: "Small heading" },
  { fmt: "bullet", icon: <FaListUl size={14} />, label: "Bullet list" },
  { fmt: "number", icon: <FaListOl size={14} />, label: "Numbered list" },
  { fmt: "quote", icon: <FaQuoteRight size={14} />, label: "Quote" },
  { fmt: "code", icon: <FaCode size={14} />, label: "Code" },
  { fmt: "rule", icon: <FaMinus size={14} />, label: "Divider line" },
];

// Formats that start a new group in the toolbar (a thin line goes before them).
const GROUP_STARTS: Format[] = ["mark", "h1", "bullet", "quote"];

// One slim strip joined to the top of the text box, like a word processor's, instead of big separate buttons.
const fmtBar: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: "2px",
  padding: "3px",
  marginTop: "4px",
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.15)",
  borderRadius: "6px 6px 0 0",
};
const fmtButton = {
  ...s.smallButton,
  justifyContent: "center",
  width: "34px",
  minWidth: "34px",
  height: "30px",
  padding: 0,
  borderRadius: "4px",
  background: "transparent",
  "--dom-bg": "transparent",
} as CSSProperties;
const fmtSep: CSSProperties = { width: "1px", height: "20px", margin: "0 3px", background: "rgba(255,255,255,0.18)", flex: "none" };

/** Drop the marker for screenshot `index` (1-based) and renumber the ones after it. */
function removeImageMarker(body: string, index: number): string {
  return body
    .replace(new RegExp(`\\n?\\[img:${index}\\]\\n?`, "g"), "\n")
    .replace(/\[img:(\d+)\]/g, (m, n) => (Number(n) > index ? `[img:${Number(n) - 1}]` : m));
}

export function folderPath(folders: Folder[], id: string | null): string {
  const parts: string[] = [];
  let cur = folders.find((f) => f.id === id);
  while (cur) {
    parts.unshift(cur.name);
    cur = folders.find((f) => f.id === cur!.parentId);
  }
  return parts.join(" / ");
}

export const NoteEditor: FC<{
  appId: string;
  note: Note | null;
  folderId: string | null;
  folders: Folder[];
  /** Shown to the speech to text so it spells game-specific words right. */
  gameName?: string;
  /** Already-attached screenshots to start a new note with (e.g. from the screenshot prompt). */
  initialScreenshots?: Screenshot[];
  defaultKind?: NoteKind;
  onSaved: (note: Note) => void;
  /** Unsaved edits from before Desk of Madness was put away, to carry on with. */
  draft?: EditorDraft;
  closeModal?: () => void;
}> = ({ appId, note, folderId: initialFolder, folders, gameName, initialScreenshots = [], defaultKind, onSaved, draft, closeModal }) => {
  const [title, setTitle] = useState(draft?.title ?? note?.title ?? "");
  const [body, setBody] = useState(draft?.body ?? note?.body ?? "");
  const [tags, setTags] = useState(draft?.tags ?? note?.tags.join(", ") ?? "");
  const [folderId, setFolderId] = useState<string | null>(draft ? draft.folderId : note?.folderId ?? initialFolder);
  const [screenshots, setScreenshots] = useState<Screenshot[]>(draft?.screenshots ?? note?.screenshots ?? initialScreenshots);
  const [checklist, setChecklist] = useState<ChecklistItem[]>(draft?.checklist ?? note?.checklist ?? []);
  const [tables, setTables] = useState<NoteTable[]>(draft?.tables ?? note?.tables ?? []);
  const [newItem, setNewItem] = useState("");
  const [spoiler, setSpoiler] = useState(draft?.spoiler ?? note?.spoiler ?? false);
  const [kind, setKind] = useState<NoteKind>(draft?.kind ?? note?.kind ?? defaultKind ?? "note");
  const [recordings, setRecordings] = useState<Recording[]>(draft?.recordings ?? note?.recordings ?? []);
  const [recordStart, setRecordStart] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const elapsed = useSessionTimer(recordStart);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const canSpeak = useSpeechAllowed();
  const [dictating, setDictating] = useState<"off" | "listening" | "writing">("off");
  const [dictateStart, setDictateStart] = useState<number | null>(null);
  const cursor = useRef<[number, number]>([0, 0]);
  const dictateElapsed = useSessionTimer(dictateStart);
  const [transcribing, setTranscribing] = useState<string | null>(null);

  // Media added in this editor session is deleted again on cancel. Media removed from the note is
  // kept on disk so older versions of the note can still be restored with it.
  const added = useRef<(Screenshot | Recording)[]>(draft?.added ?? [...initialScreenshots]);

  // Keep the edits somewhere safe, so putting Desk of Madness away with the button combo doesn't lose them.
  useEffect(() => {
    saveDraft({ title, body, tags, folderId, screenshots, checklist, tables, spoiler, kind, recordings, added: added.current });
  }, [title, body, tags, folderId, screenshots, checklist, tables, spoiler, kind, recordings]);

  const stopRecording = async () => {
    setRecordStart(null);
    const rec = await backend.stopRecording();
    if (rec) {
      added.current.push(rec);
      setRecordings((r) => [...r, rec]);
    } else {
      toaster.toast({ title: "Desk of Madness", body: "No audio was captured. Is a microphone available?" });
    }
  };

  const toggleRecording = async () => {
    if (recordStart) return stopRecording();
    try {
      await backend.startRecording(appId);
      setRecordStart(Date.now());
    } catch (e) {
      toaster.toast({ title: "Couldn't start recording", body: errText(e) });
    }
  };

  const toggleDictation = async () => {
    if (dictating === "writing") return;
    if (dictating === "listening") {
      setDictating("writing");
      setDictateStart(null);
      try {
        const words = await backend.stopDictation(appId, gameName ?? "");
        if (words) setBody((b) => insertWords(b, words, ...cursor.current));
        else toaster.toast({ title: "Desk of Madness", body: "Didn't catch anything. Try again a little louder." });
      } catch (e) {
        toaster.toast({ title: "Speech to text failed", body: errText(e) });
      }
      setDictating("off");
      return;
    }
    const el = bodyRef.current;
    cursor.current = el && document.activeElement === el ? [el.selectionStart, el.selectionEnd] : [body.length, body.length];
    try {
      await backend.startDictation();
      setDictateStart(Date.now());
      setDictating("listening");
    } catch (e) {
      toaster.toast({ title: "Couldn't start listening", body: errText(e) });
    }
  };

  const transcribe = async (rec: Recording) => {
    setTranscribing(rec.id);
    try {
      const text = await backend.transcribeRecording(appId, rec.file);
      if (text) setRecordings((list) => list.map((r) => (r.id === rec.id ? { ...r, transcript: text } : r)));
      else toaster.toast({ title: "Desk of Madness", body: "No speech found in that recording." });
    } catch (e) {
      toaster.toast({ title: "Couldn't transcribe", body: errText(e) });
    }
    setTranscribing(null);
  };

  const dropMedia = (item: Screenshot | Recording) => {
    if (added.current.includes(item)) {
      added.current = added.current.filter((i) => i !== item);
      backend.deleteMedia(appId, item);
    }
  };

  const removeScreenshot = (index: number) => {
    dropMedia(screenshots[index]);
    setScreenshots((list) => list.filter((_, i) => i !== index));
    setBody((b) => removeImageMarker(b, index + 1));
  };

  const removeRecording = (rec: Recording) => {
    dropMedia(rec);
    setRecordings((list) => list.filter((r) => r !== rec));
  };

  /** Formats the selected words, or the line the cursor is on (the textarea keeps its selection while a button has focus). */
  const format = (fmt: Format) => {
    const el = bodyRef.current;
    const [start, end] = el ? [el.selectionStart, el.selectionEnd] : [body.length, body.length];
    const next = applyFormat(body, start, end, fmt);
    setBody(next.body);
    requestAnimationFrame(() => bodyRef.current?.setSelectionRange(next.start, next.end));
  };

  const insertImage = (index: number) => {
    setBody((b) => `${b}${b && !b.endsWith("\n") ? "\n" : ""}[img:${index + 1}]\n`);
  };

  const addChecklistItem = () => {
    if (!newItem.trim()) return;
    setChecklist((list) => [...list, { id: newId(), text: newItem.trim(), done: false }]);
    setNewItem("");
  };

  const cancel = async () => {
    if (recordStart) await stopRecording();
    if (dictating !== "off") backend.cancelDictation();
    added.current.forEach((item) => backend.deleteMedia(appId, item));
    closeModal?.();
  };

  const save = async () => {
    if (recordStart) await stopRecording();
    if (dictating === "listening") backend.cancelDictation();
    setSaving(true);
    const payload: Note = {
      id: note?.id ?? newId(),
      folderId,
      title: title.trim() || "Untitled",
      body,
      tags: tags.split(",").map((t) => t.trim().replace(/^#/, "")).filter(Boolean),
      screenshots,
      recordings,
      pinned: note?.pinned ?? false,
      createdAt: note?.createdAt ?? 0,
      updatedAt: 0,
      launchNumber: note?.launchNumber ?? null,
      checklist: checklist.length ? checklist : undefined,
      tables: keepTables(tables).length ? keepTables(tables) : undefined,
      spoiler,
      kind,
      source: note?.source,
      bookstoreId: note?.bookstoreId,
    };
    const saved = await backend.saveNote(appId, payload);
    onSaved(saved);
    closeModal?.();
  };

  const confirmCancel = () => {
    const dirty =
      !!draft ||
      title !== (note?.title ?? "") ||
      body !== (note?.body ?? "") ||
      added.current.length > 0 ||
      checklist.length !== (note?.checklist?.length ?? 0) ||
      JSON.stringify(keepTables(tables)) !== JSON.stringify(note?.tables ?? []);
    if (!dirty) {
      cancel();
      return;
    }
    showModal(
      <ConfirmModal
        strTitle="Discard changes?"
        strDescription="Your edits to this note will be lost."
        strOKButtonText="Discard"
        onOK={cancel}
      />
    );
  };

  const folderOptions = [
    { label: "No folder", data: null },
    ...folders.map((f) => ({ label: folderPath(folders, f.id), data: f.id })),
  ];

  return (
    <ModalRoot className="dom-modal" onCancel={confirmCancel} bAllowFullSize bDisableBackgroundDismiss>
      <h2 style={{ marginTop: 0 }}>{note ? "Edit note" : "New note"}</h2>

      <div style={{ display: "flex", gap: "8px", alignItems: "flex-end" }}>
        <div style={{ flex: 2 }}>
          <TextField label="Title" value={title} onChange={(e) => setTitle(e.target.value)} focusOnMount={!note} />
        </div>
        <div style={{ flex: 1, paddingBottom: "2px" }}>
          <Dropdown
            rgOptions={KINDS.map((k) => ({ label: `${k.icon} ${k.label}`, data: k.kind }))}
            selectedOption={kind}
            onChange={(o) => setKind(o.data)}
            menuLabel="Type"
          />
        </div>
      </div>

      <Focusable style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: "8px", margin: "10px 0 4px" }}>
        <div style={{ flex: 1, fontSize: "13px", opacity: 0.8 }}>Information</div>
        {canSpeak && (
          <DialogButton
            style={{ ...s.smallButton, color: dictating === "listening" ? "#ff5a5a" : undefined }}
            onClick={toggleDictation}
            disabled={dictating === "writing"}
          >
            {dictating === "listening" ? (
              <>
                <FaStop /> Done {formatClock(dictateElapsed / 1000)}
              </>
            ) : dictating === "writing" ? (
              "Writing it down…"
            ) : (
              <>
                <FaMicrophoneAlt /> Speak
              </>
            )}
          </DialogButton>
        )}
      </Focusable>
      <Focusable flow-children="row" style={fmtBar}>
        {FORMATS.map((f, i) => (
          <Fragment key={f.fmt}>
            {GROUP_STARTS.includes(f.fmt) && i > 0 && <div style={fmtSep} />}
            <DialogButton style={fmtButton} onClick={() => format(f.fmt)} onOKActionDescription={f.label}>
              {f.icon}
            </DialogButton>
          </Fragment>
        ))}
      </Focusable>
      <Focusable
        onActivate={() => typeInto(bodyRef.current)}
        onOKActionDescription="Type"
        style={{ borderRadius: "0 0 6px 6px" }}
      >
        <textarea
          ref={bodyRef}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onClick={() => typeInto(bodyRef.current)}
          rows={7}
          placeholder="What happened, what to remember, where you left off…"
          style={{
            width: "100%",
            boxSizing: "border-box",
            resize: "vertical",
            background: "rgba(0,0,0,0.35)",
            color: "white",
            border: "1px solid rgba(255,255,255,0.15)",
            borderTop: "none",
            borderRadius: "0 0 6px 6px",
            padding: "8px",
            fontSize: "14px",
            fontFamily: "inherit",
          }}
        />
      </Focusable>
      <div style={{ fontSize: "12px", opacity: 0.6, marginTop: "2px" }}>
        Select words (or put the cursor on a line), then pick a style. Typing works too: **bold**, *italic*, # heading, - list.
      </div>
      {screenshots.length > 0 && (
        <div style={{ fontSize: "11px", opacity: 0.6, marginTop: "2px" }}>
          Tip: [img:1] in the text shows screenshot 1 at that spot.
        </div>
      )}

      <div style={{ display: "flex", gap: "8px", marginTop: "10px" }}>
        <div style={{ flex: 1 }}>
          <TextField label="Tags (comma separated)" value={tags} onChange={(e) => setTags(e.target.value)} />
        </div>
        {folders.length > 0 && (
          <div style={{ flex: 1, paddingTop: "18px" }}>
            <Dropdown
              rgOptions={folderOptions}
              selectedOption={folderId}
              onChange={(o) => setFolderId(o.data)}
              menuLabel="Folder"
            />
          </div>
        )}
      </div>

      <div style={{ margin: "12px 0 4px", fontSize: "13px", opacity: 0.8 }}>Checklist</div>
      {checklist.map((item) => (
        <Focusable key={item.id} style={{ ...s.toolbar, marginBottom: "4px" }}>
          <DialogButton
            style={s.smallButton}
            onClick={() => setChecklist((list) => list.map((i) => (i.id === item.id ? { ...i, done: !i.done } : i)))}
          >
            {item.done ? <FaCheckSquare /> : <FaRegSquare />}
          </DialogButton>
          <div style={{ flex: 1, textDecoration: item.done ? "line-through" : "none", opacity: item.done ? 0.6 : 1 }}>
            {item.text}
          </div>
          <DialogButton style={s.smallButton} onClick={() => setChecklist((list) => list.filter((i) => i.id !== item.id))}>
            <FaTrash size={11} />
          </DialogButton>
        </Focusable>
      ))}
      <Focusable style={s.toolbar}>
        <div style={{ flex: 1 }}>
          <TextField label="Add checklist item" value={newItem} onChange={(e) => setNewItem(e.target.value)} />
        </div>
        <DialogButton style={{ ...s.smallButton, marginTop: "18px" }} onClick={addChecklistItem} disabled={!newItem.trim()}>
          <FaPlus /> Add
        </DialogButton>
      </Focusable>

      <TablesEditor tables={tables} onChange={setTables} />

      <ToggleField
        label="Spoiler"
        description="Hide this note's contents until you choose to reveal them."
        checked={spoiler}
        onChange={setSpoiler}
      />

      <div style={{ margin: "12px 0 4px", fontSize: "13px", opacity: 0.8 }}>Attachments</div>
      <Focusable style={s.toolbar}>
        <DialogButton
          style={s.smallButton}
          onClick={() =>
            showModal(
              <ScreenshotPicker
                appId={appId}
                onAttach={(shots) => {
                  added.current.push(...shots);
                  setScreenshots((list) => [...list, ...shots]);
                }}
              />
            )
          }
        >
          <FaCamera /> Add screenshots
        </DialogButton>
        <DialogButton style={{ ...s.smallButton, color: recordStart ? "#ff5a5a" : undefined }} onClick={toggleRecording}>
          {recordStart ? (
            <>
              <FaStop /> Stop {formatClock(elapsed / 1000)}
            </>
          ) : (
            <>
              <FaMicrophone /> Record voice note
            </>
          )}
        </DialogButton>
      </Focusable>

      {recordings.length > 0 && (
        <Focusable style={{ ...s.toolbar, flexWrap: "wrap" }}>
          {recordings.map((rec, i) => (
            <Focusable key={rec.id} style={{ display: "flex", gap: "4px" }}>
              <AudioButton appId={appId} recording={rec} label={`Voice ${i + 1}`} />
              {canSpeak && !rec.transcript && (
                <DialogButton style={s.smallButton} onClick={() => transcribe(rec)} disabled={transcribing !== null}>
                  <FaFileAlt size={11} /> {transcribing === rec.id ? "Transcribing…" : "Transcribe"}
                </DialogButton>
              )}
              <DialogButton style={s.smallButton} onClick={() => removeRecording(rec)}>
                <FaTrash size={11} />
              </DialogButton>
            </Focusable>
          ))}
        </Focusable>
      )}

      <Transcripts recordings={recordings} onUse={(t) => setBody((b) => `${b}${b && !b.endsWith("\n") ? "\n" : ""}${t}\n`)} />

      {screenshots.length > 0 && (
        <Focusable flow-children="row" style={{ display: "flex", gap: "8px", overflowX: "auto", paddingBottom: "4px" }}>
          {screenshots.map((shot, i) => (
            <Focusable key={shot.id} style={{ flex: "0 0 auto", width: "180px" }}>
              <MediaImage appId={appId} file={shot.thumb ?? shot.file} style={{ width: "180px", height: "101px" }} />
              <div style={{ fontSize: "11px", opacity: 0.7, margin: "2px 0" }}>Screenshot {i + 1}</div>
              <Focusable style={{ display: "flex", gap: "4px" }}>
                <DialogButton
                  style={s.smallButton}
                  onClick={() =>
                    showModal(
                      <CropModal
                        appId={appId}
                        shot={shot}
                        onCropped={(cropped) => {
                          added.current.push(cropped);
                          setScreenshots((list) => list.map((x, j) => (j === i ? cropped : x)));
                        }}
                      />
                    )
                  }
                >
                  <FaCrop size={10} />
                </DialogButton>
                <DialogButton style={s.smallButton} onClick={() => insertImage(i)}>
                  <FaParagraph size={10} /> In text
                </DialogButton>
                <DialogButton style={s.smallButton} onClick={() => removeScreenshot(i)}>
                  <FaTrash size={10} />
                </DialogButton>
              </Focusable>
            </Focusable>
          ))}
        </Focusable>
      )}

      <Focusable style={{ display: "flex", gap: "8px", marginTop: "16px" }}>
        <DialogButton onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </DialogButton>
        <DialogButton onClick={confirmCancel}>Cancel</DialogButton>
      </Focusable>
    </ModalRoot>
  );
};
