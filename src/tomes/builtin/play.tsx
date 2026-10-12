import { FC, Fragment, ReactNode, useState } from "react";
import { DialogButton, Focusable } from "@decky/ui";
import { usePlayStats } from "../../state/playStats";
import { PlayGameTime, PlayStats } from "../../types";
import { formatDate, formatWhen, plural } from "../../utils/format";
import { gameArt } from "../../components/Library";
import { registerTome, TomeProps } from "../registry";
import { Bar, Hint, Line, Stat, ellipsis, hm, hours } from "../bits";
import * as s from "../../components/styles";

// ⏱️ Play time: Tomes over every game's sessions (py_modules/playstats.py). A session counts toward the day it
// started on; days start at 4 AM and sessions under 5 minutes don't count (both in Settings → Desk).

const BLUE = "#1a9fff";
const GREEN = "#59bf40";
const ORANGE = "#ff9a3c";

/** Draws a Tome once the shared stats are in, with a hint while there's nothing yet. */
const withStats = (draw: (st: PlayStats, p: TomeProps) => ReactNode, tileLabel: string): FC<TomeProps> =>
  function PlayTome(p) {
    const { stats, error } = usePlayStats();
    if (!stats) return p.size === "tile" ? <Stat label={tileLabel} value="…" sub={error ? "Couldn't load" : undefined} /> : <Hint>{error ?? "Loading…"}</Hint>;
    if (!stats.records.sessions && p.size !== "tile") return <Hint>Play a game and your sessions show up here (5 minutes or more).</Hint>;
    return <>{draw(stats, p)}</>;
  };

const sub = (text: ReactNode) => <div className="dom-sub" style={{ fontSize: "12px", opacity: 0.65 }}>{text}</div>;

const GameRow: FC<{ appId: string; name: string; right: ReactNode; below?: ReactNode }> = ({ appId, name, right, below }) => {
  const art = gameArt(appId);
  return (
    <Line
      icon={art ? <img src={art} style={{ width: "34px", height: "16px", objectFit: "cover", borderRadius: "3px" }} /> : "🎮"}
      style={{ alignItems: "center" }}
    >
      <div style={{ display: "flex", gap: "8px", alignItems: "baseline" }}>
        <span style={{ flex: 1, minWidth: 0, ...ellipsis }}>{name}</span>
        <b style={{ flex: "0 0 auto" }}>{right}</b>
      </div>
      {below}
    </Line>
  );
};

// ---------- Last session ----------

const LastSession = withStats((st, { size }) => {
  const l = st.last;
  if (size === "tile")
    return <Stat icon="⏱️" label={l?.live ? "This session" : "Last session"} value={l ? hm(l.seconds) : "—"} sub={l ? `${l.name} · ${l.live ? "now" : formatWhen(l.start)}` : "No sessions yet"} accent={l?.live ? GREEN : undefined} />;
  if (!l) return <Hint>No sessions yet.</Hint>;
  const art = gameArt(l.appId);
  return (
    <div
      style={{
        borderRadius: "8px",
        padding: "10px 12px",
        background: art ? `linear-gradient(90deg, rgba(14,20,27,0.94) 45%, rgba(14,20,27,0.5)), url("${art}") center/cover` : "rgba(255,255,255,0.04)",
      }}
    >
      <div style={{ fontSize: "13px", opacity: 0.75, ...ellipsis }}>{l.name}</div>
      <div style={{ fontSize: "28px", fontWeight: 800, color: l.live ? GREEN : undefined }}>{hm(l.seconds)}</div>
      {sub(l.live ? "Playing now" : `${formatWhen(l.start)} · started ${new Date(l.start).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`)}
    </div>
  );
}, "Last session");

// ---------- Games today ----------

const GamesToday = withStats((st, { size }) => {
  const games = st.today.games;
  if (size === "tile")
    return <Stat icon="🎮" label="Games today" value={games.length} sub={games.length ? games.map((g) => g.name).join(", ") : "None yet"} />;
  if (!games.length) return <Hint>Nothing played yet today.</Hint>;
  return (
    <>
      <div style={{ fontSize: "13px", opacity: 0.75, marginBottom: "4px" }}>{plural(games.length, "different game")} today</div>
      {games.map((g) => (
        <GameRow key={g.appId} appId={g.appId} name={g.name} right="" />
      ))}
    </>
  );
}, "Games today");

// ---------- Played today ----------

const TodayTime = withStats((st, { size }) => {
  const avg = st.week.seconds / 7;
  const vs = avg ? Math.round((st.today.seconds / avg) * 100) : 0;
  if (size === "tile") return <Stat icon="☀️" label="Played today" value={hm(st.today.seconds)} sub={plural(st.today.games.length, "game")} />;
  return (
    <>
      <div style={{ fontSize: "28px", fontWeight: 800 }}>{hm(st.today.seconds)}</div>
      {sub(`${plural(st.today.games.length, "game")} · your daily average this week is ${hm(avg)}${avg ? ` (today is ${vs}%)` : ""}`)}
    </>
  );
}, "Played today");

// ---------- This week ----------

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const weekday = (day: string) => DAY_NAMES[new Date(day + "T12:00:00Z").getUTCDay()];

const WeekBars: FC<{ days: { day: string; seconds: number }[]; height: number; labels: boolean }> = ({ days, height, labels }) => {
  const max = Math.max(3600, ...days.map((d) => d.seconds));
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: labels ? "6px" : "3px", height: height + (labels ? 30 : 0) }}>
      {days.map((d, i) => {
        const today = i === days.length - 1;
        return (
          <div key={d.day} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: "3px", minWidth: 0 }}>
            {labels && <div style={{ fontSize: "10px", opacity: 0.7 }}>{d.seconds ? hm(d.seconds) : ""}</div>}
            <div
              style={{
                width: "100%",
                height: Math.max(3, (d.seconds / max) * height),
                borderRadius: "3px",
                background: d.seconds ? (today ? GREEN : BLUE) : "rgba(255,255,255,0.1)",
              }}
            />
            {labels && <div style={{ fontSize: "11px", opacity: today ? 1 : 0.6, fontWeight: today ? "bold" : undefined }}>{weekday(d.day)}</div>}
          </div>
        );
      })}
    </div>
  );
};

const WeekTime = withStats((st, { size }) => {
  if (size === "tile")
    return (
      <>
        <Stat icon="📆" label="This week" value={hm(st.week.seconds)} />
        <div style={{ marginTop: "4px" }}>
          <WeekBars days={st.week.days} height={18} labels={false} />
        </div>
      </>
    );
  return (
    <>
      <div style={{ display: "flex", alignItems: "baseline", gap: "8px", marginBottom: "8px" }}>
        <span style={{ fontSize: "24px", fontWeight: 800 }}>{hm(st.week.seconds)}</span>
        <span style={{ fontSize: "12px", opacity: 0.65 }}>last 7 days</span>
      </div>
      <WeekBars days={st.week.days} height={70} labels />
    </>
  );
}, "This week");

// ---------- Streak ----------

const Streak = withStats((st, { size }) => {
  const { current, best, playedToday } = st.streak;
  const note = current && !playedToday ? "Play today to keep it going" : `Best: ${plural(best, "day")}`;
  if (size === "tile") return <Stat icon="🔥" label="Streak" value={plural(current, "day")} sub={note} accent={current ? ORANGE : undefined} />;
  const last14 = st.calendar.slice(-14);
  return (
    <>
      <div style={{ display: "flex", alignItems: "baseline", gap: "10px" }}>
        <span style={{ fontSize: "28px", fontWeight: 800, color: current ? ORANGE : undefined }}>🔥 {plural(current, "day")}</span>
        <span style={{ fontSize: "13px", opacity: 0.7 }}>best {plural(best, "day")}</span>
      </div>
      <div style={{ display: "flex", gap: "4px", marginTop: "8px" }}>
        {last14.map((d) => (
          <div key={d.day} title={d.day} style={{ flex: 1, height: "10px", borderRadius: "3px", background: d.seconds ? ORANGE : "rgba(255,255,255,0.1)" }} />
        ))}
      </div>
      {sub(current && !playedToday ? "Play today to keep it going. Last 14 days above." : "Last 14 days above.")}
    </>
  );
}, "Streak");

// ---------- Records ----------

const Records = withStats((st, { size }) => {
  const r = st.records;
  if (size === "tile") return <Stat icon="🏅" label="Longest session" value={r.longest ? hm(r.longest.seconds) : "—"} sub={`Average ${hm(r.averageSeconds)}`} />;
  const rows: [string, ReactNode][] = [
    ["Longest session", r.longest ? <>{hm(r.longest.seconds)} <span style={{ opacity: 0.6, fontWeight: "normal" }}>· {r.longest.name}, {formatDate(r.longest.start)}</span></> : "—"],
    ["Average session", hm(r.averageSeconds)],
    ["Sessions", r.sessions.toLocaleString()],
    ["Total tracked", hm(r.totalSeconds)],
    ["Best streak", plural(st.streak.best, "day")],
  ];
  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "3px 14px", fontSize: "14px" }}>
        {rows.map(([k, v]) => (
          <Fragment key={k}>
            <span style={{ opacity: 0.65 }}>{k}</span>
            <b style={ellipsis}>{v}</b>
          </Fragment>
        ))}
      </div>
      {st.trackedSince && sub(`Since ${formatDate(st.trackedSince)}`)}
    </>
  );
}, "Records");

// ---------- Most played ----------

type Period = "week" | "month" | "allTime";
const PERIODS: { id: Period; label: string }[] = [
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
  { id: "allTime", label: "All time" },
];
let lastPeriod: Period = "week";

const TopList: FC<{ list: PlayGameTime[]; allTime: boolean }> = ({ list, allTime }) => {
  if (!list.length) return <Hint>Nothing played in this time.</Hint>;
  const max = list[0].seconds;
  return (
    <>
      {list.map((g, i) => (
        <GameRow
          key={g.appId}
          appId={g.appId}
          name={`${i + 1}. ${g.name}`}
          right={allTime ? hours(g.seconds) : hm(g.seconds)}
          below={<Bar value={g.seconds / max} color={i === 0 ? ORANGE : BLUE} height={4} style={{ marginTop: "4px" }} />}
        />
      ))}
    </>
  );
};

const MostPlayed: FC<TomeProps> = ({ size }) => {
  const [period, setPeriodState] = useState<Period>(lastPeriod);
  const setPeriod = (x: Period) => setPeriodState((lastPeriod = x));
  const { stats, error } = usePlayStats();
  const label = PERIODS.find((x) => x.id === period)!.label;
  const list = stats?.mostPlayed[period] ?? [];
  const time = (sec: number) => (period === "allTime" ? hours(sec) : hm(sec));
  if (size === "tile")
    return <Stat icon="👑" label={`Most played · ${label}`} value={stats ? (list[0] ? time(list[0].seconds) : "—") : "…"} sub={list[0]?.name ?? (stats ? "Nothing yet" : undefined)} />;
  if (!stats) return <Hint>{error ?? "Loading…"}</Hint>;
  return (
    <>
      <Focusable flow-children="row" style={{ display: "flex", gap: "4px", marginBottom: "6px" }}>
        {PERIODS.map((x) => (
          <DialogButton
            key={x.id}
            style={{ ...s.smallButton, padding: "2px 10px", fontSize: "12px", minHeight: 0, ...(x.id === period ? s.tint(BLUE) : {}) }}
            onClick={() => setPeriod(x.id)}
          >
            {x.label}
          </DialogButton>
        ))}
      </Focusable>
      <TopList list={list} allTime={period === "allTime"} />
      {period === "allTime" && sub("All time uses Steam's own playtime.")}
    </>
  );
};

// ---------- Activity ----------

const level = (sec: number) => (sec <= 0 ? 0 : sec < 1800 ? 1 : sec < 3600 ? 2 : sec < 7200 ? 3 : sec < 14400 ? 4 : 5);
const SHADES = ["rgba(255,255,255,0.07)", "#0e3a5c", "#105a8f", "#1479c4", "#1a9fff", "#7cc8ff"];

const Heatmap: FC<{ days: { day: string; seconds: number }[]; cell: number }> = ({ days, cell }) => {
  // Columns are weeks starting on Sunday; pad the first one so weekdays line up.
  const pad = new Date(days[0].day + "T12:00:00Z").getUTCDay();
  const cells = [...Array(pad).fill(null), ...days];
  return (
    <div style={{ display: "grid", gridTemplateRows: `repeat(7, ${cell}px)`, gridAutoFlow: "column", gridAutoColumns: `${cell}px`, gap: "3px", overflow: "hidden" }}>
      {cells.map((d, i) =>
        d ? <div key={d.day} title={`${d.day}: ${hm(d.seconds)}`} style={{ borderRadius: "2px", background: SHADES[level(d.seconds)] }} /> : <div key={`pad${i}`} />
      )}
    </div>
  );
};

const Activity = withStats((st, { size, fullScreen }) => {
  if (size === "tile")
    return (
      <>
        <Stat icon="🗓️" label="Activity" value={`${st.calendar.slice(-28).filter((d) => d.seconds).length}/28`} sub="days played, last 4 weeks" />
      </>
    );
  const days = fullScreen ? st.calendar : st.calendar.slice(-84);
  const played = days.filter((d) => d.seconds).length;
  return (
    <>
      <Heatmap days={days} cell={fullScreen ? 13 : 11} />
      <div style={{ display: "flex", alignItems: "center", gap: "4px", marginTop: "6px", fontSize: "11px", opacity: 0.75 }}>
        <span style={{ flex: 1 }}>
          {played} of {days.length} days played
        </span>
        Less
        {SHADES.map((c) => (
          <span key={c} style={{ width: "9px", height: "9px", borderRadius: "2px", background: c }} />
        ))}
        More
      </div>
    </>
  );
}, "Activity");

// ---------- registration ----------

const play = (id: string, name: string, icon: string, description: string, component: FC<TomeProps>, defaultSize: "tile" | "card" = "tile") =>
  registerTome({ id, name, icon, category: "play", description, defaultOn: false, needsGame: false, component, sizes: ["tile", "card"], defaultSize });

play("last-session", "Last Session", "⏱️", "How long you played last time, and what. Counts up while you play.", LastSession);
play("games-today", "Games Today", "🎮", "How many different games you've played today.", GamesToday);
play("today-time", "Played Today", "☀️", "Today's playtime across every game.", TodayTime);
play("week-time", "This Week", "📆", "The last 7 days' playtime, with a bar for each day.", WeekTime);
play("streak", "Streak", "🔥", "Days in a row you've played, and your best run.", Streak);
play("records", "Records", "🏅", "Longest session, average session and totals.", Records);
play("most-played", "Most Played", "👑", "Your top games this week, this month or of all time.", MostPlayed, "card");
play("activity", "Activity", "🗓️", "A calendar of how much you played each day.", Activity, "card");
