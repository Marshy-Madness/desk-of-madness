// A reader page's article as a list of blocks (headings, paragraphs, lists, tables…) that can be picked one by
// one, and picked blocks as plain note text.

export interface Block {
  /** Markup for the block alone (shown through desk.reader.elements, never innerHTML). */
  html: string;
  /** 2–6 for headings, 0 otherwise. */
  level: number;
  /** The heading's words, for headings. */
  heading?: string;
}

const BLOCKY = new Set(["p", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "dl", "table", "figure", "blockquote", "pre", "hr", "div"]);
const HEADING = /^h([2-6])$/;

/** The blocks in `html`, top to bottom. Wrapper divs are opened up so their insides can be picked separately. */
export function toBlocks(html: string): Block[] {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const out: Block[] = [];
  let inline: Node[] = [];

  const flush = () => {
    if (inline.some((n) => (n.textContent ?? "").trim() || (n as Element).tagName === "IMG")) {
      const p = doc.createElement("p");
      inline.forEach((n) => p.appendChild(n));
      out.push({ html: p.outerHTML, level: 0 });
    }
    inline = [];
  };

  const walk = (parent: Node) => {
    for (const node of Array.from(parent.childNodes)) {
      if (node.nodeType !== 1) {
        if (node.nodeType === 3) inline.push(node);
        continue;
      }
      const el = node as Element;
      const tag = el.tagName.toLowerCase();
      if (!BLOCKY.has(tag)) {
        inline.push(el);
        continue;
      }
      flush();
      // A wrapper holding other blocks: open it up. A div of plain text is a block of its own.
      if (tag === "div" && Array.from(el.children).some((c) => BLOCKY.has(c.tagName.toLowerCase()))) {
        walk(el);
        flush();
        continue;
      }
      if (!(el.textContent ?? "").trim() && !el.querySelector("img")) continue;
      const h = HEADING.exec(tag);
      out.push({ html: el.outerHTML, level: h ? Number(h[1]) : 0, heading: h ? squash(el.textContent ?? "") : undefined });
    }
  };
  walk(doc.body);
  flush();
  return out;
}

/** Block indexes in the section a heading starts (it and everything up to the next heading as big or bigger). */
export function sectionOf(blocks: Block[], i: number): number[] {
  const level = blocks[i]?.level;
  if (!level) return [i];
  const out = [i];
  for (let j = i + 1; j < blocks.length && !(blocks[j].level && blocks[j].level <= level); j++) out.push(j);
  return out;
}

/** The heading a block sits under (for naming a note), if any. */
export function headingFor(blocks: Block[], i: number): string | undefined {
  for (let j = i; j >= 0; j--) if (blocks[j].heading) return blocks[j].heading;
  return undefined;
}

const squash = (t: string) => t.replace(/\s+/g, " ").trim();

/** Picked blocks as plain text for a note body: headings as ■ lines, lists as bullets, tables as rows. */
export function toText(blocks: Block[]): string {
  const parts: string[] = [];
  const doc = new DOMParser().parseFromString("<body></body>", "text/html");
  for (const b of blocks) {
    const box = doc.createElement("div");
    box.innerHTML = b.html; // a detached document: nothing in it loads or runs
    const t = text(box.firstElementChild ?? box, 0).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    if (t) parts.push(b.level ? `■ ${t}` : t);
  }
  return parts.join("\n\n");
}

function inlineText(el: Node): string {
  let out = "";
  el.childNodes.forEach((n) => {
    if (n.nodeType === 3) out += n.textContent;
    else if (n.nodeType === 1) {
      const tag = (n as Element).tagName.toLowerCase();
      if (tag === "br") out += "\n";
      else if (tag === "img" || tag === "figure") return;
      else if (/^(ul|ol|table|dl)$/.test(tag)) out += "\n" + text(n as Element, 1) + "\n";
      else out += inlineText(n);
    }
  });
  return out.replace(/[ \t\r\f\v]+/g, " ");
}

function text(el: Element, depth: number): string {
  const tag = el.tagName.toLowerCase();
  const indent = "  ".repeat(Math.max(0, depth - 1));
  if (tag === "ul" || tag === "ol") {
    return Array.from(el.children)
      .filter((li) => li.tagName === "LI")
      .map((li, i) => {
        const nested = Array.from(li.children).filter((c) => /^(UL|OL)$/.test(c.tagName));
        nested.forEach((n) => n.remove());
        const line = `${indent}${tag === "ol" ? `${i + 1}.` : "•"} ${squash(inlineText(li))}`;
        return [line, ...nested.map((n) => text(n, depth + 1))].join("\n");
      })
      .join("\n");
  }
  if (tag === "table") {
    // Line breaks inside a cell (lists of names and the like) become commas, so each row stays one line.
    const cell = (c: Element) => inlineText(c).split("\n").map(squash).filter(Boolean).join(", ");
    const rows = Array.from(el.querySelectorAll("tr")).map((tr) => Array.from(tr.children).map(cell));
    const caption = el.querySelector("caption");
    const lines = rows
      .filter((r) => r.some(Boolean))
      .map((r) => (r.length === 2 && el.querySelector("tr > th + td") ? `${r[0]}: ${r[1]}` : r.join(" | ")));
    return [caption ? squash(caption.textContent ?? "") : "", ...lines].filter(Boolean).join("\n");
  }
  if (tag === "dl") {
    return Array.from(el.children)
      .map((c) => (c.tagName === "DT" ? `${squash(inlineText(c))}:` : `  ${squash(inlineText(c))}`))
      .join("\n");
  }
  if (tag === "figure") {
    const cap = el.querySelector("figcaption");
    return cap ? `(${squash(cap.textContent ?? "")})` : "";
  }
  if (tag === "hr") return "———";
  return inlineText(el)
    .split("\n")
    .map((l) => l.trim())
    .join("\n");
}
