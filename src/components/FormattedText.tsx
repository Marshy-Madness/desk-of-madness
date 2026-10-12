import { CSSProperties, FC, Fragment, ReactNode } from "react";
import { Focusable } from "@decky/ui";
import { LinkSource, openLink, splitLinks } from "../browser";
import { Inline, parseBlocks, parseInline } from "../utils/markup";

type LinkOpts = { from?: LinkSource; beforeOpen?: () => void };

const linkStyle: CSSProperties = { display: "inline", color: "#59bfff", textDecoration: "underline", cursor: "pointer", overflowWrap: "anywhere" };

function withLinks(text: string, opts: LinkOpts, key: string): ReactNode {
  const parts = splitLinks(text);
  if (!parts.some((p) => p.url)) return text;
  const open = (url: string) => {
    opts.beforeOpen?.();
    openLink(url, opts.from);
  };
  return parts.map((p, i) =>
    p.url ? (
      <Focusable
        key={`${key}-${i}`}
        onActivate={() => open(p.url!)}
        onClick={() => open(p.url!)}
        onOKActionDescription="Open link"
        style={linkStyle}
      >
        {p.text}
      </Focusable>
    ) : (
      <Fragment key={`${key}-${i}`}>{p.text}</Fragment>
    )
  );
}

function renderInline(nodes: Inline[], opts: LinkOpts, key = "i"): ReactNode[] {
  return nodes.map((n, i) => {
    const k = `${key}-${i}`;
    switch (n.type) {
      case "text":
        return <Fragment key={k}>{withLinks(n.text, opts, k)}</Fragment>;
      case "code":
        return (
          <code key={k} style={{ background: "rgba(255,255,255,0.12)", borderRadius: "3px", padding: "0 4px", fontSize: "0.92em" }}>
            {n.text}
          </code>
        );
      case "bold":
        return <b key={k}>{renderInline(n.children, opts, k)}</b>;
      case "italic":
        return <i key={k}>{renderInline(n.children, opts, k)}</i>;
      case "underline":
        return <u key={k}>{renderInline(n.children, opts, k)}</u>;
      case "strike":
        return <s key={k} style={{ opacity: 0.7 }}>{renderInline(n.children, opts, k)}</s>;
      case "mark":
        return (
          <mark key={k} style={{ background: "rgba(255,214,10,0.35)", color: "inherit", borderRadius: "2px", padding: "0 2px" }}>
            {renderInline(n.children, opts, k)}
          </mark>
        );
    }
  });
}

/** One line of formatted words (table cells, list items). */
export const FormattedInline: FC<{ text: string } & LinkOpts> = ({ text, ...opts }) => <>{renderInline(parseInline(text), opts)}</>;

const lines = (ls: string[], opts: LinkOpts) =>
  ls.map((l, i) => (
    <Fragment key={i}>
      {i > 0 && <br />}
      {renderInline(parseInline(l), opts, `l${i}`)}
    </Fragment>
  ));

/** A note's information with its formatting (headings, lists, quotes, bold…) and tappable links. */
export const FormattedText: FC<{ text: string; style?: CSSProperties } & LinkOpts> = ({ text, style, ...opts }) => (
  <div style={{ fontSize: "14px", lineHeight: 1.4, overflowWrap: "anywhere", ...style }}>
    {parseBlocks(text).map((b, i) => {
      switch (b.type) {
        case "heading":
          return (
            <div key={i} style={{ fontWeight: 700, fontSize: ["", "20px", "17px", "15px"][b.level], margin: "10px 0 4px" }}>
              {renderInline(parseInline(b.text), opts)}
            </div>
          );
        case "rule":
          return <hr key={i} style={{ border: 0, borderTop: "1px solid rgba(255,255,255,0.25)", margin: "10px 0" }} />;
        case "quote":
          return (
            <div key={i} style={{ borderLeft: "3px solid rgba(255,255,255,0.35)", padding: "2px 0 2px 10px", margin: "6px 0", opacity: 0.85 }}>
              {lines(b.lines, opts)}
            </div>
          );
        case "list": {
          let n = b.start - 1;
          return (
            <div key={i} style={{ margin: "4px 0" }}>
              {b.items.map((item, j) => (
                <div key={j} style={{ display: "flex", gap: "6px", paddingLeft: `${4 + item.indent * 18}px` }}>
                  <span style={{ flex: "0 0 auto", minWidth: b.ordered ? "18px" : "10px", textAlign: "right", opacity: 0.8 }}>
                    {b.ordered ? `${++n}.` : item.indent ? "◦" : "•"}
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>{renderInline(parseInline(item.text), opts, `li${j}`)}</span>
                </div>
              ))}
            </div>
          );
        }
        case "para":
          return (
            <div key={i} style={{ margin: "4px 0" }}>
              {lines(b.lines, opts)}
            </div>
          );
      }
    })}
  </div>
);
