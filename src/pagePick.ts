// Picking bits of a page (paragraphs, headings, list items, pictures, tables...) with the left stick, to save
// them to notes. The same functions run on the reader's article and, sent as text through the debugging port,
// inside the full-page view; so they mustn't use anything from outside themselves.

export interface PickedBlock {
  kind: string; // the element's tag, lower case
  text: string;
  src?: string; // pictures
  link?: string; // the first link inside
}

/** Picks the next (1) or previous (-1) bit of the page from the one picked, or from the first one on screen. */
export function stepBlock(root: Element, step: number): PickedBlock | null {
  const TEXT = "p,h1,h2,h3,h4,h5,h6,li,blockquote,pre,table,dt,dd,figcaption";
  const MARK = "data-dom-pick";
  const box = root === document.body ? { top: 0, bottom: window.innerHeight } : root.getBoundingClientRect();
  const blocks = Array.from(root.querySelectorAll<HTMLElement>(TEXT + ",img")).filter((el) => {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    if (el.tagName === "IMG") return r.width >= 48 && !el.parentElement?.closest(TEXT);
    // The innermost bits: a list item holding paragraphs gives the paragraphs.
    return !!el.innerText.trim() && !el.querySelector(TEXT);
  });
  if (!blocks.length) return null;
  const onScreen = (el: Element) => {
    const r = el.getBoundingClientRect();
    return r.bottom > box.top + 4 && r.top < box.bottom - 4;
  };
  const cur = root.querySelector<HTMLElement>(`[${MARK}]`);
  let i = cur && onScreen(cur) ? blocks.indexOf(cur) : -1;
  if (i < 0) {
    const shown = blocks.filter(onScreen);
    const from = step > 0 ? shown[0] : shown[shown.length - 1];
    i = from ? blocks.indexOf(from) : step > 0 ? 0 : blocks.length - 1;
  } else {
    i = Math.max(0, Math.min(blocks.length - 1, i + step));
  }
  const el = blocks[i];
  if (cur && cur !== el) {
    cur.removeAttribute(MARK);
    cur.style.outline = cur.dataset.domPickOutline ?? "";
    cur.style.background = cur.dataset.domPickBackground ?? "";
  }
  if (cur !== el) {
    el.setAttribute(MARK, "");
    el.dataset.domPickOutline = el.style.outline;
    el.dataset.domPickBackground = el.style.background;
    el.style.outline = "2px solid #1a9fff";
    el.style.background = "rgba(26,159,255,0.15)";
  }
  el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  const kind = el.tagName.toLowerCase();
  const a = el.querySelector<HTMLAnchorElement>("a[href]") ?? el.closest<HTMLAnchorElement>("a[href]");
  const href = a?.dataset.href ?? a?.href;
  return {
    kind,
    text: kind === "img" ? (el as HTMLImageElement).alt || "" : el.innerText.trim().slice(0, 4000),
    src: kind === "img" ? (el as HTMLImageElement).src : undefined,
    link: href && /^https?:\/\//i.test(href) ? href : undefined,
  };
}

/** Takes the highlight off whatever is picked. */
export function clearBlock(root: Element): void {
  const el = root.querySelector<HTMLElement>("[data-dom-pick]");
  if (!el) return;
  el.removeAttribute("data-dom-pick");
  el.style.outline = el.dataset.domPickOutline ?? "";
  el.style.background = el.dataset.domPickBackground ?? "";
}

/** The same, as scripts for the full-page view. */
export const stepBlockScript = (step: number) => `(${stepBlock.toString()})(document.body, ${step})`;
export const clearBlockScript = () => `(${clearBlock.toString()})(document.body)`;

/** A picked bit as note text, in the notes' own light formatting. */
export function blockAsText(b: PickedBlock): string {
  if (b.kind === "img") return b.text ? `${b.text}\n${b.src}` : b.src ?? "";
  if (/^h[1-6]$/.test(b.kind)) return `## ${b.text.replace(/\s+/g, " ")}`;
  if (b.kind === "li") return `- ${b.text.replace(/\n+/g, " ")}`;
  return b.text;
}
