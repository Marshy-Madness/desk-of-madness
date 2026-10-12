import { FC, ReactNode, useMemo } from "react";
import { summarize, useAchievements, useGameAchievements, AchievementSummary } from "../../state/achievements";
import { goAchievements } from "../../radial/go";
import { AchievementRow, GOLD, isPerfect, Ring } from "../../achievements/parts";
import { registerTome, TomeProps } from "../registry";
import { Bar, Btn, Buttons, Hint, Line, Stat, ellipsis } from "../bits";
import { formatWhen } from "../../utils/format";

// 🏆 Achievements: Tomes over the Steam achievements state/achievements.ts reads from the Steam client.
// A on any of their tiles (or "View all" on a card) opens the full achievements page.

const withSummary = (draw: (sum: AchievementSummary, p: TomeProps) => ReactNode, tileLabel: string): FC<TomeProps> =>
  function TrophyTome(p) {
    const data = useAchievements();
    const sum = useMemo(() => summarize(data), [data]);
    if (!sum.games.length)
      return p.size === "tile" ? <Stat label={tileLabel} value="…" sub="Asking Steam" /> : <Hint>Asking Steam for your achievements…</Hint>;
    return <>{draw(sum, p)}</>;
  };

const viewAll = (appId?: string | null, view?: "library" | "timeline") => (
  <Buttons>
    <Btn onClick={() => goAchievements(appId, view)}>View all</Btn>
  </Buttons>
);

const GameLine: FC<{ appId: string; name: string; unlocked: number; total: number }> = ({ appId, name, unlocked, total }) => (
  <Line icon={<Ring value={unlocked / total} size={20} stroke={3} label="" />} onOpen={() => goAchievements(appId)} okLabel="Achievements" style={{ alignItems: "center" }}>
    <div style={{ display: "flex", gap: "8px" }}>
      <span style={{ flex: 1, minWidth: 0, ...ellipsis }}>{name}</span>
      <b>{Math.floor((unlocked / total) * 100)}%</b>
    </div>
    <div className="dom-sub" style={{ fontSize: "12px", opacity: 0.65 }}>
      {unlocked} / {total} · {total - unlocked} left
    </div>
  </Line>
);

// ---------- Achievement % ----------

const Percent = withSummary((sum, { size }) => {
  if (size === "tile")
    return <Stat icon="📈" label="Achievement %" value={`${sum.avgStarted.toFixed(1)}%`} sub={`${sum.avgAll.toFixed(1)}% over all games`} />;
  return (
    <>
      <div style={{ display: "flex", gap: "16px", alignItems: "center" }}>
        <Ring value={sum.avgStarted / 100} size={64} stroke={7} label={`${Math.round(sum.avgStarted)}%`} />
        <div style={{ fontSize: "13px", lineHeight: 1.6 }}>
          <div>
            <b>{sum.avgStarted.toFixed(1)}%</b> <span style={{ opacity: 0.7 }}>over {sum.started.length} started games</span>
          </div>
          <div>
            <b>{sum.avgAll.toFixed(1)}%</b> <span style={{ opacity: 0.7 }}>over all {sum.games.length} games with achievements</span>
          </div>
        </div>
      </div>
      {viewAll()}
    </>
  );
}, "Achievement %");

// ---------- Perfect games ----------

const Perfect = withSummary((sum, { size }) => {
  const close = sum.almost.filter((g) => g.total - g.unlocked <= 3).length;
  if (size === "tile")
    return <Stat icon="⭐" label="Perfect games" value={sum.perfect.length} sub={close ? `${close} within 3` : `${sum.started.length} started`} accent={sum.perfect.length ? GOLD : undefined} />;
  const latest = [...sum.perfect].sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0)).slice(0, 4);
  return (
    <>
      <div style={{ fontSize: "28px", fontWeight: 800, color: sum.perfect.length ? GOLD : undefined }}>★ {sum.perfect.length}</div>
      {latest.map((g) => (
        <GameLine key={g.appId} {...g} />
      ))}
      {close > 0 && <Hint>{close} more within 3 achievements.</Hint>}
      {viewAll()}
    </>
  );
}, "Perfect games");

// ---------- This game ----------

const GameProgress: FC<TomeProps> = ({ game, size }) => {
  const g = useGameAchievements(game?.appId);
  if (!game) return null;
  if (!g || !g.total)
    return size === "tile" ? <Stat icon="🏆" label="This game" value="—" sub="No achievements" /> : <Hint>{g ? "This game has no achievements." : "Asking Steam…"}</Hint>;
  const pct = g.unlocked / g.total;
  if (size === "tile")
    return (
      <>
        <Stat icon="🏆" label={game.name} value={`${Math.floor(pct * 100)}%`} sub={`${g.unlocked} / ${g.total}`} accent={isPerfect(g) ? GOLD : undefined} />
        <Bar value={pct} color={isPerfect(g) ? GOLD : undefined} height={4} style={{ marginTop: "4px" }} />
      </>
    );
  const next = (g.list ?? [])
    .filter((a) => !a.unlockedAt)
    .sort((a, b) => (b.progress ? b.progress.current / b.progress.max : 0) - (a.progress ? a.progress.current / a.progress.max : 0) || (b.globalPct ?? 0) - (a.globalPct ?? 0))
    .slice(0, 3);
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "8px" }}>
        <Ring value={pct} size={52} stroke={6} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: "15px", fontWeight: "bold" }}>
            {g.unlocked} of {g.total}
          </div>
          <Bar value={pct} color={isPerfect(g) ? GOLD : undefined} style={{ marginTop: "4px" }} />
        </div>
      </div>
      {next.length > 0 && <div style={{ fontSize: "11px", fontWeight: "bold", letterSpacing: "0.06em", textTransform: "uppercase", opacity: 0.6, margin: "4px 0" }}>Up next (most players have these)</div>}
      {next.map((a) => (
        <AchievementRow key={a.id} a={a} compact />
      ))}
      {viewAll(game.appId)}
    </>
  );
};

// ---------- Recent unlocks ----------

const Recent = withSummary((sum, { size }) => {
  const latest = sum.recent[0];
  if (size === "tile")
    return <Stat icon="🔓" label="Latest unlock" value={latest ? latest.a.name : "—"} sub={latest ? `${latest.game.name} · ${formatWhen(latest.a.unlockedAt * 1000)}` : "None yet"} />;
  if (!sum.recent.length) return <Hint>No unlocks loaded yet.</Hint>;
  return (
    <>
      {sum.recent.slice(0, 5).map(({ game, a }) => (
        <AchievementRow key={game.appId + a.id} a={a} game={game.name} compact onOpen={() => goAchievements(game.appId)} />
      ))}
      {viewAll(null, "timeline")}
    </>
  );
}, "Latest unlock");

// ---------- Almost perfect ----------

const Almost = withSummary((sum, { size }) => {
  const top = sum.almost[0];
  if (size === "tile")
    return <Stat icon="🎯" label="Almost perfect" value={top ? `${top.total - top.unlocked} left` : "—"} sub={top?.name ?? "Nothing started"} />;
  if (!sum.almost.length) return <Hint>Nothing in progress.</Hint>;
  return (
    <>
      {sum.almost.slice(0, 5).map((g) => (
        <GameLine key={g.appId} {...g} />
      ))}
      {viewAll()}
    </>
  );
}, "Almost perfect");

// ---------- Rarest ----------

const Rarest = withSummary((sum, { size }) => {
  const r = sum.rarest;
  if (size === "tile")
    return <Stat icon="💎" label="Rarest unlock" value={r ? `${r.a.globalPct!.toFixed(1)}%` : "—"} sub={r ? `${r.a.name} · ${r.game.name}` : "Open a game to load"} accent={r ? "#e05cff" : undefined} />;
  if (!r) return <Hint>Your rarest unlock shows once your games' lists are in.</Hint>;
  const runners = sum.recent
    .filter((x) => x.a.globalPct != null && x !== r)
    .sort((a, b) => a.a.globalPct! - b.a.globalPct!)
    .slice(0, 2);
  return (
    <>
      <AchievementRow a={r.a} game={r.game.name} onOpen={() => goAchievements(r.game.appId)} />
      {runners.map(({ game, a }) => (
        <AchievementRow key={game.appId + a.id} a={a} game={game.name} compact onOpen={() => goAchievements(game.appId)} />
      ))}
    </>
  );
}, "Rarest unlock");

// ---------- Totals ----------

const Totals = withSummary((sum, { size }) => {
  if (size === "tile") return <Stat icon="🏆" label="Achievements" value={sum.unlocked.toLocaleString()} sub={`${sum.unlockedThisWeek} this week`} />;
  return (
    <>
      <div style={{ display: "flex", alignItems: "baseline", gap: "8px" }}>
        <span style={{ fontSize: "28px", fontWeight: 800 }}>{sum.unlocked.toLocaleString()}</span>
        <span style={{ opacity: 0.7, fontSize: "13px" }}>of {sum.total.toLocaleString()} unlocked</span>
      </div>
      <Bar value={sum.total ? sum.unlocked / sum.total : 0} style={{ margin: "6px 0" }} />
      <div style={{ fontSize: "13px", opacity: 0.8 }}>
        {sum.unlockedThisWeek} this week · {sum.started.length} games started · {sum.games.length} with achievements
      </div>
      {viewAll()}
    </>
  );
}, "Achievements");

// ---------- registration ----------

const open = () => goAchievements();
const trophy = (
  id: string,
  name: string,
  icon: string,
  description: string,
  component: FC<TomeProps>,
  extra: { defaultSize?: "tile" | "card"; needsGame?: boolean; onTileOpen?: (p: TomeProps) => void } = {}
) =>
  registerTome({
    id,
    name,
    icon,
    category: "trophies",
    description,
    defaultOn: false,
    needsGame: !!extra.needsGame,
    component,
    sizes: ["tile", "card"],
    defaultSize: extra.defaultSize ?? "tile",
    onTileOpen: extra.onTileOpen ?? open,
  });

trophy("ach-percent", "Achievement %", "📈", "Your average completion: over started games, and over every game.", Percent);
trophy("perfect-games", "Perfect Games", "⭐", "Games with every achievement unlocked.", Perfect);
trophy("unlock-totals", "Achievement Totals", "🏆", "Everything you've unlocked, and how many this week.", Totals);
trophy("rarest", "Rarest Unlock", "💎", "Your rarest achievement by how few players have it.", Rarest);
trophy("game-achievements", "This Game's Achievements", "🎮", "The current game's progress and what to go for next.", GameProgress, {
  defaultSize: "card",
  needsGame: true,
  onTileOpen: (p) => goAchievements(p.game?.appId),
});
trophy("recent-unlocks", "Recent Unlocks", "🔓", "Your latest unlocks across every game.", Recent, { defaultSize: "card", onTileOpen: () => goAchievements(null, "timeline") });
trophy("almost-perfect", "Almost Perfect", "🎯", "The games you're closest to finishing.", Almost, { defaultSize: "card" });
