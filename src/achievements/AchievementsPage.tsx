import { FC, ReactNode, useEffect, useMemo, useState } from "react";
import { DialogButton, Focusable, GamepadButton, GamepadEvent } from "@decky/ui";
import { FaSyncAlt } from "react-icons/fa";
import { closeNotesPage, setNotesPageMounted } from "../opening";
import { useRunningGame } from "../hooks/useAppLifetime";
import { refreshGame, refreshLibrary, summarize, useAchievements, useGameAchievements } from "../state/achievements";
import { ensureTheme } from "../theme";
import { useChromeHeights, useSteamPath } from "../steamWindow";
import { useTrackpadMouse } from "../trackpads";
import { GameAchievements } from "../types";
import { formatDate } from "../utils/format";
import { gameArt } from "../components/Library";
import { AchievementRow, GOLD, headerArt, isPerfect, Ring } from "./parts";
import * as s from "../components/styles";

// The full achievements page: big numbers up top, then the library (every game with a ring), the unlock
// timeline, or one game's list. L1 / R1 switch between Library and Timeline; B goes back from a game, then
// closes. Opened from any achievement Tome, the radial menu, its combo, or Desk Commands.

type View = "library" | "timeline";
type Sort = "recent" | "percent" | "closest" | "name";
const SORTS: { id: Sort; label: string }[] = [
  { id: "recent", label: "Recently played" },
  { id: "percent", label: "Highest %" },
  { id: "closest", label: "Closest to perfect" },
  { id: "name", label: "Name" },
];
type Filter = "all" | "unlocked" | "locked";

function readAddress(path: string): { app: string | null; view: View } {
  const q = new URLSearchParams(path.split("?")[1] ?? "");
  return { app: q.get("app"), view: q.get("view") === "timeline" ? "timeline" : "library" };
}

const chip = (on: boolean) => ({
  ...s.smallButton,
  padding: "3px 12px",
  fontSize: "12px",
  minHeight: 0,
  height: "28px",
  ...(on ? s.tint("#1a9fff") : {}),
});

export const AchievementsPage: FC = () => {
  const path = useSteamPath();
  const { header, footer } = useChromeHeights();
  const running = useRunningGame();
  const data = useAchievements();
  const sum = useMemo(() => summarize(data), [data]);
  const [{ app, view }, setAddress] = useState(() => readAddress(path));
  const [sort, setSort] = useState<Sort>("recent");
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    ensureTheme();
    setNotesPageMounted(true);
    return () => setNotesPageMounted(false);
  }, []);
  useEffect(() => setAddress(readAddress(path)), [path]);
  useTrackpadMouse();

  const openGame = (id: string | null) => setAddress((a) => ({ ...a, app: id }));
  const setView = (v: View) => setAddress({ app: null, view: v });
  const back = () => (app ? openGame(null) : closeNotesPage());
  const onButtonDown = (e: GamepadEvent) => {
    if (e.detail.button === GamepadButton.BUMPER_RIGHT || e.detail.button === GamepadButton.BUMPER_LEFT)
      setView(view === "library" ? "timeline" : "library");
  };
  const refresh = async () => {
    setRefreshing(true);
    try {
      await refreshLibrary(true);
      if (app) await refreshGame(app, true);
    } finally {
      setRefreshing(false);
    }
  };

  const games = useMemo(() => {
    const list = [...sum.games];
    const left = (g: GameAchievements) => g.total - g.unlocked;
    const by: Record<Sort, (a: GameAchievements, b: GameAchievements) => number> = {
      recent: (a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0),
      percent: (a, b) => b.unlocked / b.total - a.unlocked / a.total,
      closest: (a, b) => Number(isPerfect(a)) - Number(isPerfect(b)) || Number(b.unlocked > 0) - Number(a.unlocked > 0) || left(a) - left(b),
      name: (a, b) => a.name.localeCompare(b.name),
    };
    return list.sort(by[sort]);
  }, [sum, sort]);

  return (
    <div className="dom-root" style={{ marginTop: `${header}px`, height: `calc(100% - ${header}px)`, overflowY: "scroll", boxSizing: "border-box" }}>
      <Focusable
        onButtonDown={onButtonDown}
        onCancelButton={back}
        onCancelActionDescription={app ? "Library" : "Close"}
        style={{ maxWidth: "1180px", margin: "0 auto", padding: `12px 24px ${footer + 40}px` }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "10px" }}>
          <div style={{ fontSize: "22px", fontWeight: 800, flex: 1 }}>🏆 Achievements</div>
          <DialogButton style={{ ...s.smallButton, height: "34px" }} onClick={refresh} disabled={refreshing}>
            <FaSyncAlt /> {refreshing ? "Asking Steam…" : "Refresh"}
          </DialogButton>
        </div>

        <StatsHeader sum={sum} />

        {app ? (
          <GameView appId={app} live={running?.appId === app} onBack={() => openGame(null)} />
        ) : (
          <>
            <Focusable flow-children="row" style={{ display: "flex", alignItems: "center", gap: "6px", margin: "14px 0 10px" }}>
              <span style={bumper}>L1</span>
              {(["library", "timeline"] as View[]).map((v) => (
                <DialogButton
                  key={v}
                  style={{ ...s.smallButton, flex: "1 1 0", justifyContent: "center", height: "36px", ...(v === view ? s.tint("#7a4dd8") : {}) }}
                  onClick={() => setView(v)}
                >
                  {v === "library" ? `🎮 Library (${sum.games.length})` : `🕒 Timeline`}
                </DialogButton>
              ))}
              <span style={bumper}>R1</span>
            </Focusable>
            {view === "library" ? (
              <>
                <Focusable flow-children="row" style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "10px" }}>
                  {SORTS.map((x) => (
                    <DialogButton key={x.id} style={chip(x.id === sort)} onClick={() => setSort(x.id)}>
                      {x.label}
                    </DialogButton>
                  ))}
                </Focusable>
                {games.length ? (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: "10px" }}>
                    {games.map((g) => (
                      <GameCard key={g.appId} g={g} onOpen={() => openGame(g.appId)} />
                    ))}
                  </div>
                ) : (
                  <Empty />
                )}
              </>
            ) : (
              <Timeline sum={sum} onOpenGame={openGame} />
            )}
          </>
        )}
      </Focusable>
    </div>
  );
};

const bumper = {
  flex: "0 0 auto",
  fontSize: "11px",
  fontWeight: "bold",
  padding: "3px 7px",
  borderRadius: "5px",
  border: "1px solid rgba(255,255,255,0.3)",
  opacity: 0.75,
} as const;

const Empty: FC = () => (
  <div style={{ opacity: 0.75, fontSize: "14px", padding: "20px 0" }}>
    No achievements yet. Steam is asked about your library a little after Steam starts; press Refresh to ask now.
  </div>
);

const Tile: FC<{ label: string; value: ReactNode; sub?: ReactNode; color?: string }> = ({ label, value, sub, color }) => (
  <div
    style={{
      padding: "12px 14px",
      borderRadius: "12px",
      background: "linear-gradient(160deg, rgba(255,255,255,0.08), rgba(255,255,255,0.02))",
      border: "1px solid rgba(255,255,255,0.08)",
      minWidth: 0,
    }}
  >
    <div style={{ fontSize: "11px", fontWeight: "bold", letterSpacing: "0.06em", textTransform: "uppercase", opacity: 0.65 }}>{label}</div>
    <div style={{ fontSize: "28px", fontWeight: 800, color, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{value}</div>
    {sub && <div style={{ fontSize: "12px", opacity: 0.7, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sub}</div>}
  </div>
);

const StatsHeader: FC<{ sum: ReturnType<typeof summarize> }> = ({ sum }) => (
  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "10px" }}>
    <Tile label="Unlocked" value={sum.unlocked.toLocaleString()} sub={`of ${sum.total.toLocaleString()} · ${sum.unlockedThisWeek} this week`} />
    <Tile label="Average completion" value={`${sum.avgStarted.toFixed(1)}%`} sub={`${sum.avgAll.toFixed(1)}% over all ${sum.games.length} games`} />
    <Tile label="Perfect games" value={sum.perfect.length} sub={`${sum.started.length} started`} color={sum.perfect.length ? GOLD : undefined} />
    <Tile
      label="Rarest unlock"
      value={sum.rarest ? `${sum.rarest.a.globalPct!.toFixed(1)}%` : "—"}
      sub={sum.rarest ? `${sum.rarest.a.name} · ${sum.rarest.game.name}` : "Open a game to load its list"}
      color={sum.rarest ? "#e05cff" : undefined}
    />
  </div>
);

const GameCard: FC<{ g: GameAchievements; onOpen: () => void }> = ({ g, onOpen }) => {
  const perfect = isPerfect(g);
  const art = gameArt(g.appId) ?? headerArt(g.appId);
  return (
    <Focusable
      onActivate={onOpen}
      onClick={onOpen}
      onOKActionDescription="Achievements"
      style={{
        borderRadius: "10px",
        overflow: "hidden",
        background: "rgba(255,255,255,0.04)",
        border: `2px solid ${perfect ? GOLD : "rgba(255,255,255,0.07)"}`,
        boxShadow: perfect ? "0 0 14px rgba(245,197,66,0.25)" : undefined,
      }}
    >
      <div style={{ height: "86px", background: `url("${art}") center/cover`, position: "relative" }}>
        {perfect && (
          <div style={{ position: "absolute", top: 6, right: 6, ...s.chip, background: GOLD, color: "#222", fontWeight: "bold", opacity: 1 }}>★ Perfect</div>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "8px 10px" }}>
        <Ring value={g.unlocked / g.total} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "14px", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{g.name}</div>
          <div style={{ fontSize: "12px", opacity: 0.7 }}>
            {g.unlocked} / {g.total}
            {!perfect && g.unlocked > 0 && ` · ${g.total - g.unlocked} left`}
          </div>
        </div>
      </div>
    </Focusable>
  );
};

const GameView: FC<{ appId: string; live: boolean; onBack: () => void }> = ({ appId, live, onBack }) => {
  const g = useGameAchievements(appId);
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<"default" | "rarity" | "date">("default");
  const art = gameArt(appId) ?? headerArt(appId);
  const list = (g?.list ?? [])
    .filter((a) => (filter === "all" ? true : filter === "unlocked" ? a.unlockedAt : !a.unlockedAt))
    .sort((a, b) =>
      sort === "rarity"
        ? (a.globalPct ?? 100) - (b.globalPct ?? 100)
        : sort === "date"
        ? b.unlockedAt - a.unlockedAt
        : Number(!!b.unlockedAt) - Number(!!a.unlockedAt) || b.unlockedAt - a.unlockedAt
    );
  return (
    <div style={{ marginTop: "14px" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "16px",
          padding: "14px 16px",
          borderRadius: "12px",
          background: `linear-gradient(90deg, rgba(14,20,27,0.95) 40%, rgba(14,20,27,0.55)), url("${art}") center/cover`,
          marginBottom: "10px",
        }}
      >
        {g && <Ring value={g.total ? g.unlocked / g.total : 0} size={72} stroke={7} />}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "22px", fontWeight: 800 }}>{g?.name ?? appId}</div>
          <div style={{ fontSize: "13px", opacity: 0.8 }}>
            {g ? `${g.unlocked} of ${g.total} unlocked${isPerfect(g) ? " · ★ Perfect game" : ""}` : "Loading…"}
            {live && " · Playing now"}
          </div>
        </div>
        <Focusable>
          <DialogButton style={s.smallButton} onClick={onBack}>
            ‹ Library
          </DialogButton>
        </Focusable>
      </div>
      <Focusable flow-children="row" style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "10px" }}>
        {(["all", "unlocked", "locked"] as Filter[]).map((f) => (
          <DialogButton key={f} style={chip(f === filter)} onClick={() => setFilter(f)}>
            {f === "all" ? "All" : f === "unlocked" ? "Unlocked" : "Locked"}
          </DialogButton>
        ))}
        <span style={{ width: "12px" }} />
        {(
          [
            ["default", "Unlocked first"],
            ["date", "Newest"],
            ["rarity", "Rarest"],
          ] as const
        ).map(([id, label]) => (
          <DialogButton key={id} style={chip(id === sort)} onClick={() => setSort(id)}>
            {label}
          </DialogButton>
        ))}
      </Focusable>
      {g && !g.list && <div style={{ opacity: 0.75 }}>Getting the list from Steam…</div>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(480px, 1fr))", gap: "0 10px" }}>
        {list.map((a) => (
          <AchievementRow key={a.id} a={a} />
        ))}
      </div>
    </div>
  );
};

const Timeline: FC<{ sum: ReturnType<typeof summarize>; onOpenGame: (id: string) => void }> = ({ sum, onOpenGame }) => {
  const days: { day: string; items: typeof sum.recent }[] = [];
  for (const x of sum.recent.slice(0, 200)) {
    const day = formatDate(x.a.unlockedAt * 1000);
    const last = days[days.length - 1];
    if (last?.day === day) last.items.push(x);
    else days.push({ day, items: [x] });
  }
  if (!days.length)
    return <div style={{ opacity: 0.75, fontSize: "14px" }}>Unlocks show up here once the lists for your recently played games are in.</div>;
  return (
    <>
      {days.map((d) => (
        <div key={d.day} style={{ marginBottom: "12px" }}>
          <div style={{ ...s.sectionLabel, display: "flex", gap: "8px" }}>
            {d.day} <span style={{ opacity: 0.6 }}>· {d.items.length}</span>
          </div>
          {d.items.map(({ game, a }) => (
            <AchievementRow key={game.appId + a.id} a={a} game={game.name} onOpen={() => onOpenGame(game.appId)} />
          ))}
        </div>
      ))}
    </>
  );
};

