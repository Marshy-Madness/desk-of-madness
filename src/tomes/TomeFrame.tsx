import { FC, ReactNode } from "react";
import { DialogButton, Focusable } from "@decky/ui";
import { FaArrowDown, FaArrowLeft, FaArrowRight, FaArrowUp, FaChevronDown, FaChevronRight, FaCompressAlt, FaExpandAlt, FaEyeSlash } from "react-icons/fa";
import { registerTomeElement } from "./wheel";
import * as s from "../components/styles";

const frame = {
  background: "rgba(255,255,255,0.035)",
  border: "1px solid rgba(255,255,255,0.07)",
  borderRadius: "8px",
  padding: "8px 10px",
  marginBottom: "10px",
  breakInside: "avoid" as const,
};

const editButton = { ...s.iconButton, width: "36px", minWidth: "36px", height: "32px", fontSize: "13px" };

/** A Tome's box: a title bar (A folds it), and in edit mode buttons to move or hide it. */
export const TomeFrame: FC<{
  id: string;
  icon: string;
  name: string;
  collapsed: boolean;
  editing: boolean;
  isFirst: boolean;
  isLast: boolean;
  onToggle: () => void;
  onMove: (by: -1 | 1) => void;
  onHide: () => void;
  /** Turns it into a tile (edit mode), when it can be one. */
  onTile?: () => void;
  /** Shown on the right of the title bar (counts, badges). */
  extra?: ReactNode;
  children: ReactNode;
}> = ({ id, icon, name, collapsed, editing, isFirst, isLast, onToggle, onMove, onHide, onTile, extra, children }) => (
  <div ref={(el) => registerTomeElement(id, el)} className="dom-tome" style={frame}>
    <Focusable flow-children="row" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
      <Focusable
        data-tome-head
        style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: "8px", padding: "4px 2px" }}
        onActivate={onToggle}
        onClick={onToggle}
        onOKActionDescription={collapsed ? "Unfold" : "Fold"}
      >
        <span style={{ fontSize: "16px" }}>{icon}</span>
        <span style={{ ...s.title, fontSize: "13px", letterSpacing: "0.05em", textTransform: "uppercase", opacity: 0.85 }}>{name}</span>
        <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", opacity: 0.75 }}>
          {extra}
          {collapsed ? <FaChevronRight size={11} /> : <FaChevronDown size={11} />}
        </span>
      </Focusable>
      {editing && (
        <>
          <DialogButton style={editButton} disabled={isFirst} onClick={() => onMove(-1)} {...({ "aria-label": "Move up" } as any)}>
            <FaArrowUp />
          </DialogButton>
          <DialogButton style={editButton} disabled={isLast} onClick={() => onMove(1)} {...({ "aria-label": "Move down" } as any)}>
            <FaArrowDown />
          </DialogButton>
          {onTile && (
            <DialogButton style={editButton} onClick={onTile} {...({ "aria-label": "Make it a tile" } as any)}>
              <FaCompressAlt />
            </DialogButton>
          )}
          <DialogButton style={editButton} onClick={onHide} {...({ "aria-label": "Take off the Desk" } as any)}>
            <FaEyeSlash />
          </DialogButton>
        </>
      )}
    </Focusable>
    {!collapsed && <div style={{ marginTop: "6px" }}>{children}</div>}
  </div>
);

const tileButton = { ...s.iconButton, width: "30px", minWidth: "30px", height: "26px", fontSize: "11px" };

/**
 * A Tome drawn as a tile: no title bar, just its content (a big number), several to a row. A runs the
 * Tome's tile action; in edit mode, buttons move it, make it a card, or take it off the page.
 */
export const TileFrame: FC<{
  id: string;
  editing: boolean;
  isFirst: boolean;
  isLast: boolean;
  canCard: boolean;
  onOpen?: () => void;
  okLabel?: string;
  onMove: (by: -1 | 1) => void;
  onCard: () => void;
  onHide: () => void;
  children: ReactNode;
}> = ({ id, editing, isFirst, isLast, canCard, onOpen, okLabel, onMove, onCard, onHide, children }) => (
  <div ref={(el) => registerTomeElement(id, el)} className="dom-tile" style={{ minWidth: 0, display: "flex", flexDirection: "column" }}>
    <Focusable
      data-tome-head
      className="dom-tile-body"
      style={tile}
      onActivate={onOpen ?? (() => {})}
      onClick={onOpen}
      onOKActionDescription={onOpen ? okLabel ?? "Open" : undefined}
    >
      {children}
    </Focusable>
    {editing && (
      <Focusable flow-children="row" style={{ display: "flex", gap: "4px", marginTop: "4px", justifyContent: "center" }}>
        <DialogButton style={tileButton} disabled={isFirst} onClick={() => onMove(-1)} {...({ "aria-label": "Move back" } as any)}>
          <FaArrowLeft />
        </DialogButton>
        <DialogButton style={tileButton} disabled={isLast} onClick={() => onMove(1)} {...({ "aria-label": "Move on" } as any)}>
          <FaArrowRight />
        </DialogButton>
        {canCard && (
          <DialogButton style={tileButton} onClick={onCard} {...({ "aria-label": "Make it a card" } as any)}>
            <FaExpandAlt />
          </DialogButton>
        )}
        <DialogButton style={tileButton} onClick={onHide} {...({ "aria-label": "Take off the page" } as any)}>
          <FaEyeSlash />
        </DialogButton>
      </Focusable>
    )}
  </div>
);

const tile = {
  flex: 1,
  minHeight: "78px",
  boxSizing: "border-box" as const,
  padding: "9px 11px",
  borderRadius: "10px",
  background: "linear-gradient(160deg, rgba(255,255,255,0.075), rgba(255,255,255,0.02))",
  border: "1px solid rgba(255,255,255,0.08)",
  display: "flex",
  flexDirection: "column" as const,
  justifyContent: "center",
  overflow: "hidden",
};
