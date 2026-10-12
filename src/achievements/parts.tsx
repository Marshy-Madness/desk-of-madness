import { CSSProperties, FC, useState } from "react";
import { Focusable } from "@decky/ui";
import { Achievement, GameAchievements } from "../types";
import { formatDate } from "../utils/format";

// Pieces the achievements page and the achievement Tomes share.

export const GOLD = "#f5c542";
export const BLUE = "#1a9fff";

export const pctOf = (g: GameAchievements) => (g.total ? Math.floor((g.unlocked / g.total) * 100) : 0);
export const isPerfect = (g: GameAchievements) => g.total > 0 && g.unlocked >= g.total;

export const headerArt = (appId: string) => `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/header.jpg`;

/** Rarity buckets by the share of players who have it. */
export function rarity(pct?: number): { label: string; color: string } | null {
  if (pct == null) return null;
  if (pct < 5) return { label: "Ultra rare", color: "#e05cff" };
  if (pct < 15) return { label: "Rare", color: "#4fa3ff" };
  if (pct < 40) return { label: "Uncommon", color: "#59bf40" };
  return { label: "Common", color: "rgba(255,255,255,0.55)" };
}

/** A ring that fills with the % done; gold when it's all done. */
export const Ring: FC<{ value: number; size?: number; stroke?: number; label?: string }> = ({ value, size = 44, stroke = 5, label }) => {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const done = value >= 1;
  return (
    <div style={{ position: "relative", width: size, height: size, flex: "0 0 auto" }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={done ? GOLD : BLUE}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${c * Math.max(0, Math.min(1, value))} ${c}`}
        />
      </svg>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: size >= 60 ? "15px" : "11px",
          fontWeight: "bold",
          color: done ? GOLD : undefined,
        }}
      >
        {label ?? `${Math.floor(value * 100)}%`}
      </div>
    </div>
  );
};

export const AchIcon: FC<{ a: Achievement; size?: number; blur?: boolean }> = ({ a, size = 40, blur }) => {
  const style: CSSProperties = {
    width: size,
    height: size,
    borderRadius: "6px",
    flex: "0 0 auto",
    objectFit: "cover",
    filter: a.unlockedAt ? undefined : `grayscale(1) brightness(0.55)${blur ? " blur(4px)" : ""}`,
    background: "rgba(255,255,255,0.08)",
  };
  return a.icon ? <img src={a.icon} style={style} /> : <div style={{ ...style, display: "flex", alignItems: "center", justifyContent: "center" }}>🏆</div>;
};

/**
 * One achievement. Locked hidden ones are blurred until you press A on them (`revealed`), so the list
 * doesn't spoil the story.
 */
export const AchievementRow: FC<{ a: Achievement; game?: string; compact?: boolean; onOpen?: () => void }> = ({ a, game, compact, onOpen }) => {
  const secret = a.hidden && !a.unlockedAt;
  const [revealed, setRevealed] = useState(false);
  const blur = secret && !revealed;
  const r = rarity(a.globalPct);
  const act = secret ? () => setRevealed((x) => !x) : onOpen;
  return (
    <Focusable
      className="dom-line"
      onActivate={act ?? (() => {})}
      onClick={act}
      onOKActionDescription={secret ? (revealed ? "Hide" : "Reveal") : onOpen ? "Open" : undefined}
      style={{
        display: "flex",
        gap: "10px",
        alignItems: "center",
        padding: compact ? "5px 8px" : "7px 10px",
        marginBottom: "4px",
        borderRadius: "8px",
        background: a.unlockedAt ? "rgba(245,197,66,0.06)" : "rgba(255,255,255,0.035)",
        border: `1px solid ${a.unlockedAt ? "rgba(245,197,66,0.18)" : "rgba(255,255,255,0.06)"}`,
      }}
    >
      <AchIcon a={a} size={compact ? 32 : 44} blur={blur} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: "14px", fontWeight: 600, filter: blur ? "blur(5px)" : undefined, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {blur ? "Hidden achievement" : a.name}
        </div>
        <div
          className="dom-sub"
          style={{
            fontSize: "12px",
            opacity: 0.7,
            filter: blur ? "blur(5px)" : undefined,
            whiteSpace: compact ? "nowrap" : undefined,
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {blur ? "Press A to reveal it" : game ? `${game} · ${a.description}` : a.description || (secret ? "Hidden achievement" : "")}
        </div>
        {!a.unlockedAt && a.progress && !compact && (
          <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "4px", fontSize: "11px", opacity: 0.8 }}>
            <div style={{ flex: 1, height: 4, borderRadius: 4, background: "rgba(255,255,255,0.1)" }}>
              <div style={{ width: `${(a.progress.current / a.progress.max) * 100}%`, height: "100%", borderRadius: 4, background: BLUE }} />
            </div>
            {a.progress.current} / {a.progress.max}
          </div>
        )}
      </div>
      <div style={{ flex: "0 0 auto", textAlign: "right", fontSize: "11px" }}>
        {a.unlockedAt > 1 && <div style={{ color: GOLD }}>{formatDate(a.unlockedAt * 1000)}</div>}
        {r && (
          <div style={{ color: r.color, opacity: 0.95 }}>
            {a.globalPct!.toFixed(1)}%{!compact && ` · ${r.label}`}
          </div>
        )}
      </div>
    </Focusable>
  );
};
