// Light formatting for a note's information, written as plain text so it syncs, merges and searches like
// before and old notes look the same. The website's index.html has a copy of the parser (renderMarkup).
//
//   # Heading   ## Smaller   ### Smallest       - bullet   * bullet   1. numbered   > quote   --- divider
//   **bold**  *italic*  __underline__  ~~strike~~  ==highlight==  `code`

export type Inline =
  | { type: "text"; text: string }
  | { type: "bold" | "italic" | "underline" | "strike" | "mark"; children: Inline[] }
  | { type: "code"; text: string };

export type Block =
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "list"; ordered: boolean; start: number; items: { text: string; indent: number }[] }
  | { type: "quote"; lines: string[] }
  | { type: "rule" }
  | { type: "para"; lines: string[] };

// Bold may hold single-star italics; italics don't start or end on a space (so "5 * 3 * 2" stays as it is).
const INLINE = /(\*\*\*[^*\n]+?\*\*\*|\*\*(?:[^*\n]|\*(?!\*))+?\*\*|__[^_\n]+?__|~~[^~\n]+?~~|==[^=\n]+?==|`[^`\n]+?`|\*[^*\s](?:[^*\n]*?[^*\s])?\*)/;
const MARKERS: [string, Exclude<Inline["type"], "text" | "code">][] = [
  ["**", "bold"],
  ["__", "underline"],
  ["~~", "strike"],
  ["==", "mark"],
  ["*", "italic"],
];

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  text.split(INLINE).forEach((part, i) => {
    if (!part) return;
    if (i % 2 === 0) out.push({ type: "text", text: part });
    else if (part.startsWith("`")) out.push({ type: "code", text: part.slice(1, -1) });
    else if (part.startsWith("***")) out.push({ type: "bold", children: [{ type: "italic", children: parseInline(part.slice(3, -3)) }] });
    else {
      const [mark, type] = MARKERS.find(([m]) => part.startsWith(m))!;
      out.push({ type, children: parseInline(part.slice(mark.length, -mark.length)) });
    }
  });
  return out;
}

const BULLET = /^(\s*)[-*•]\s+(.*)$/;
const NUMBER = /^(\s*)(\d+)[.)]\s+(.*)$/;

export function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  const last = () => blocks[blocks.length - 1];
  for (const line of text.split("\n")) {
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^(#{1,3})\s+(.*)$/))) {
      blocks.push({ type: "heading", level: m[1].length as 1 | 2 | 3, text: m[2] });
    } else if (/^\s*(-{3,}|_{3,}|\*{3,})\s*$/.test(line)) {
      blocks.push({ type: "rule" });
    } else if ((m = line.match(BULLET)) || (m = line.match(NUMBER))) {
      const ordered = m.length === 4;
      const item = { text: m[m.length - 1], indent: Math.min(3, Math.floor(m[1].replace(/\t/g, "  ").length / 2)) };
      const prev = last();
      if (prev?.type === "list" && prev.ordered === ordered) prev.items.push(item);
      else blocks.push({ type: "list", ordered, start: ordered ? Number(m[2]) : 1, items: [item] });
    } else if ((m = line.match(/^>\s?(.*)$/))) {
      const prev = last();
      if (prev?.type === "quote") prev.lines.push(m[1]);
      else blocks.push({ type: "quote", lines: [m[1]] });
    } else {
      const prev = last();
      if (prev?.type === "para") prev.lines.push(line);
      else blocks.push({ type: "para", lines: [line] });
    }
  }
  // Blank lines only separate things; trim them off the ends of paragraphs.
  return blocks.flatMap((b): Block[] => {
    if (b.type !== "para") return [b];
    let { lines } = b;
    while (lines.length && !lines[0].trim()) lines = lines.slice(1);
    while (lines.length && !lines[lines.length - 1].trim()) lines = lines.slice(0, -1);
    return lines.length ? [{ ...b, lines }] : [];
  });
}

/** The words without the formatting marks, for one-line previews. */
export function stripMarkup(line: string): string {
  return line
    .replace(/^\s*(#{1,3}|>|[-*•]|\d+[.)])\s+/, "")
    .replace(/^\s*(-{3,}|_{3,}|\*{3,})\s*$/, "")
    .replace(/(\*\*|__|~~|==|`)(.+?)\1/g, "$2")
    .replace(/\*([^*\s][^*]*?)\*/g, "$1");
}

// ---------- editing ----------

export type InlineFormat = "bold" | "italic" | "underline" | "strike" | "mark" | "code";
export type LineFormat = "h1" | "h2" | "bullet" | "number" | "quote";
export type Format = InlineFormat | LineFormat | "rule";

const WRAP: Record<InlineFormat, string> = { bold: "**", italic: "*", underline: "__", strike: "~~", mark: "==", code: "`" };
const PREFIX: Record<Exclude<LineFormat, "number">, string> = { h1: "# ", h2: "## ", bullet: "- ", quote: "> " };
const ANY_PREFIX = /^(\s*)(#{1,3}\s+|>\s?|[-*•]\s+|\d+[.)]\s+)?/;

export interface Edit {
  body: string;
  start: number;
  end: number;
}

/** Applies a toolbar button to the selection: wraps (or unwraps) it, or toggles the start of each line it covers. */
export function applyFormat(body: string, start: number, end: number, fmt: Format): Edit {
  if (fmt === "rule") {
    const before = body.slice(0, start);
    const insert = `${before && !before.endsWith("\n") ? "\n" : ""}---\n`;
    const pos = start + insert.length;
    return { body: before + insert + body.slice(end), start: pos, end: pos };
  }
  if (fmt in WRAP) {
    const mark = WRAP[fmt as InlineFormat];
    const n = mark.length;
    // Already wrapped: take the marks off.
    // Stars are shared between bold and italic (***both***): italic is on when there's an odd run of them.
    const stars = (from: number, step: number) => {
      let k = 0;
      while (body[from + k * step] === "*") k++;
      return k;
    };
    const wrapped =
      fmt === "italic"
        ? stars(start - 1, -1) % 2 === 1 && stars(end, 1) % 2 === 1
        : fmt === "bold"
          ? stars(start - 1, -1) >= 2 && stars(end, 1) >= 2
          : body.slice(start - n, start) === mark && body.slice(end, end + n) === mark;
    if (wrapped) {
      return { body: body.slice(0, start - n) + body.slice(start, end) + body.slice(end + n), start: start - n, end: end - n };
    }
    // Keep spaces picked up by the selection outside the marks, or they won't count as formatting.
    let a = start, b = end;
    while (a < b && /\s/.test(body[a])) a++;
    while (b > a && /\s/.test(body[b - 1])) b--;
    const words = body.slice(a, b) || "text";
    return { body: body.slice(0, a) + mark + words + mark + body.slice(b), start: a + n, end: a + n + words.length };
  }
  const lineStart = body.lastIndexOf("\n", start - 1) + 1;
  let lineEnd = body.indexOf("\n", Math.max(end - (end > start && body[end - 1] === "\n" ? 1 : 0), start));
  if (lineEnd < 0) lineEnd = body.length;
  const lines = body.slice(lineStart, lineEnd).split("\n");
  const has = (l: string) =>
    fmt === "number" ? NUMBER.test(l) : l.replace(/^\s*/, "").startsWith(PREFIX[fmt as Exclude<LineFormat, "number">]);
  const removing = lines.every((l) => !l.trim() || has(l));
  let count = 0;
  const changed = lines.map((l) => {
    if (!l.trim()) return l;
    const [, indent, old = ""] = l.match(ANY_PREFIX)!;
    const rest = l.slice(indent.length + old.length);
    if (removing) return indent + rest;
    const keepIndent = fmt === "bullet" || fmt === "number" ? indent : "";
    return keepIndent + (fmt === "number" ? `${++count}. ` : PREFIX[fmt as Exclude<LineFormat, "number">]) + rest;
  });
  const text = changed.join("\n");
  return { body: body.slice(0, lineStart) + text + body.slice(lineEnd), start: lineStart + text.length, end: lineStart + text.length };
}
