import { FC, useState } from "react";
import { DialogButton, Focusable, TextField, ToggleField } from "@decky/ui";
import { FaChevronDown, FaChevronRight, FaMinus, FaPlus, FaTable, FaTrash } from "react-icons/fa";
import { NoteTable } from "../types";
import { newId } from "../utils/format";
import { FormattedInline } from "./FormattedText";
import * as s from "./styles";

const cell = { padding: "4px 8px", border: "1px solid rgba(255,255,255,0.15)", verticalAlign: "top", fontSize: "13px" } as const;

export const newTable = (): NoteTable => ({ id: newId(), title: "", columns: ["", ""], rows: [["", ""], ["", ""]], showInView: true });

/** Tables with nothing typed in them aren't worth saving. */
export const keepTables = (tables: NoteTable[]) =>
  tables.filter((t) => t.title.trim() || t.columns.some((c) => c.trim()) || t.rows.some((r) => r.some((c) => c.trim())));

const TableGrid: FC<{ table: NoteTable }> = ({ table }) => (
  <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed", overflowWrap: "anywhere" }}>
    {table.columns.some((c) => c.trim()) && (
      <thead>
        <tr>
          {table.columns.map((c, i) => (
            <th key={i} style={{ ...cell, background: "rgba(255,255,255,0.1)", textAlign: "left" }}>
              <FormattedInline text={c} />
            </th>
          ))}
        </tr>
      </thead>
    )}
    <tbody>
      {table.rows.map((row, r) => (
        <tr key={r} style={{ background: r % 2 ? "rgba(255,255,255,0.04)" : undefined }}>
          {table.columns.map((_, c) => (
            <td key={c} style={cell}>
              <FormattedInline text={row[c] ?? ""} />
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  </table>
);

/** The note's tables when reading it: open ones show straight away, the rest are a line you open. */
export const TablesView: FC<{ tables?: NoteTable[] }> = ({ tables }) => {
  const [open, setOpen] = useState<Set<string>>(new Set());
  if (!tables?.length) return null;
  const toggle = (id: string) =>
    setOpen((cur) => {
      const next = new Set(cur);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  return (
    <>
      {tables.map((t) => {
        const name = t.title.trim() || "Table";
        if (t.showInView) {
          return (
            <Focusable key={t.id} style={{ margin: "10px 0" }} onActivate={() => {}}>
              {t.title.trim() && <div style={{ fontSize: "13px", fontWeight: 600, marginBottom: "4px" }}>{name}</div>}
              <TableGrid table={t} />
            </Focusable>
          );
        }
        const shown = open.has(t.id);
        return (
          <Focusable key={t.id} style={{ margin: "8px 0" }}>
            <Focusable
              style={{ ...s.row, padding: "6px 10px", marginBottom: shown ? "6px" : 0 }}
              onActivate={() => toggle(t.id)}
              onClick={() => toggle(t.id)}
              onOKActionDescription={shown ? "Hide table" : "Show table"}
            >
              {shown ? <FaChevronDown size={11} /> : <FaChevronRight size={11} />}
              <FaTable size={12} />
              <span style={{ flex: 1 }}>{name}</span>
              <span style={{ fontSize: "12px", opacity: 0.7 }}>
                {t.rows.length} × {t.columns.length}
              </span>
            </Focusable>
            {shown && <TableGrid table={t} />}
          </Focusable>
        );
      })}
    </>
  );
};

const resize = (t: NoteTable, cols: number, rows: number): NoteTable => ({
  ...t,
  columns: Array.from({ length: cols }, (_, i) => t.columns[i] ?? ""),
  rows: Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => t.rows[r]?.[c] ?? "")),
});

const TableEditor: FC<{ table: NoteTable; onChange: (t: NoteTable) => void; onRemove: () => void }> = ({ table: t, onChange, onRemove }) => {
  const setCell = (r: number, c: number, v: string) => onChange({ ...t, rows: t.rows.map((row, i) => (i === r ? row.map((x, j) => (j === c ? v : x)) : row)) });
  const setHead = (c: number, v: string) => onChange({ ...t, columns: t.columns.map((x, j) => (j === c ? v : x)) });
  const grid = { display: "grid", gridTemplateColumns: `repeat(${t.columns.length}, minmax(0, 1fr))`, gap: "4px" };
  return (
    <div style={{ border: "1px solid rgba(255,255,255,0.15)", borderRadius: "6px", padding: "8px", marginBottom: "8px" }}>
      <TextField label="Table name" value={t.title} onChange={(e) => onChange({ ...t, title: e.target.value })} />
      <ToggleField
        label="Show when reading"
        description="Open in the note without going into Edit. Off: it's a line you open."
        checked={!!t.showInView}
        onChange={(v) => onChange({ ...t, showInView: v })}
      />
      <div style={{ fontSize: "12px", opacity: 0.7, margin: "6px 0 2px" }}>Column headings</div>
      <Focusable flow-children="row" style={grid}>
        {t.columns.map((c, i) => (
          <TextField key={i} value={c} onChange={(e) => setHead(i, e.target.value)} />
        ))}
      </Focusable>
      <div style={{ fontSize: "12px", opacity: 0.7, margin: "6px 0 2px" }}>Rows</div>
      {t.rows.map((row, r) => (
        <Focusable key={r} flow-children="row" style={{ ...grid, marginBottom: "4px" }}>
          {row.map((v, c) => (
            <TextField key={c} value={v} onChange={(e) => setCell(r, c, e.target.value)} />
          ))}
        </Focusable>
      ))}
      <Focusable style={{ ...s.toolbar, flexWrap: "wrap", marginTop: "6px" }}>
        <DialogButton style={s.smallButton} onClick={() => onChange(resize(t, t.columns.length, t.rows.length + 1))}>
          <FaPlus size={10} /> Row
        </DialogButton>
        <DialogButton style={s.smallButton} disabled={t.rows.length <= 1} onClick={() => onChange(resize(t, t.columns.length, t.rows.length - 1))}>
          <FaMinus size={10} /> Row
        </DialogButton>
        <DialogButton style={s.smallButton} disabled={t.columns.length >= 6} onClick={() => onChange(resize(t, t.columns.length + 1, t.rows.length))}>
          <FaPlus size={10} /> Column
        </DialogButton>
        <DialogButton style={s.smallButton} disabled={t.columns.length <= 1} onClick={() => onChange(resize(t, t.columns.length - 1, t.rows.length))}>
          <FaMinus size={10} /> Column
        </DialogButton>
        <DialogButton style={s.smallButton} onClick={onRemove}>
          <FaTrash size={10} /> Remove table
        </DialogButton>
      </Focusable>
    </div>
  );
};

/** The Tables part of the note editor. */
export const TablesEditor: FC<{ tables: NoteTable[]; onChange: (tables: NoteTable[]) => void }> = ({ tables, onChange }) => (
  <>
    <div style={{ margin: "12px 0 4px", fontSize: "13px", opacity: 0.8 }}>Tables</div>
    {tables.map((t) => (
      <TableEditor
        key={t.id}
        table={t}
        onChange={(next) => onChange(tables.map((x) => (x.id === t.id ? next : x)))}
        onRemove={() => onChange(tables.filter((x) => x.id !== t.id))}
      />
    ))}
    <Focusable style={s.toolbar}>
      <DialogButton style={s.smallButton} onClick={() => onChange([...tables, newTable()])}>
        <FaTable size={11} /> Add table
      </DialogButton>
    </Focusable>
  </>
);
