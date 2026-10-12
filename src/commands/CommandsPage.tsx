import { FC, ReactNode, useEffect, useState } from "react";
import { DialogButton, Focusable, TextField } from "@decky/ui";
import { toaster } from "@decky/api";
import { backend } from "../api/backend";
import { closeNotesPage, setNotesPageMounted } from "../opening";
import { getRunningGame, useRunningGame } from "../hooks/useAppLifetime";
import { deskGame } from "../state/deskGame";
import { emitDataChanged } from "../state/notesStore";
import { useSpeechAllowed } from "../state/speech";
import { ensureTheme } from "../theme";
import { useChromeHeights, useSteamPath } from "../steamWindow";
import { kindInfo } from "../utils/kinds";
import { errText } from "../utils/errors";
import { newId } from "../utils/format";
import { startVoiceNote, stopVoiceNote, useVoiceNoteRecording } from "../tomes/builtin/voiceNote";
import { runCommand, toggleVoiceCommand, voiceBusy } from "../voice";
import { CommandsView, goDesk, goEditNote, goNewNote, goNote, goNotes, goWeb } from "../radial/go";
import { DockerContainer, Game, GameSummary, HomeEntity, NoteHit } from "../types";
import { Roll, rollDice, rollLabel } from "./dice";
import { formatDuration, parseDuration, startTimer, stopTimer, useTimers } from "./timers";
import * as s from "../components/styles";

// Desk Commands: the command palette. One page, opened by its button combo, the radial menu, Quick Actions or
// "open commands". Pick a command with the D-pad and A, or type: the box filters the list, and "Run" sends
// what you typed through the same command words as voice commands ("note called Nether Portal with 342, 71,
// -892", "roll 2d6", "timer 5 minutes", "turn on office light"). B goes back, then closes.

const VIEWS: CommandsView[] = ["main", "search", "timer", "dice", "home", "docker", "games"];
const TIMER_PRESETS = [1, 3, 5, 10, 15, 20, 30, 45, 60];
const DICE = ["d4", "d6", "d8", "d10", "d12", "d20", "d100", "2d6", "coin"];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function readAddress(path: string): { view: CommandsView; q: string } {
  const query = new URLSearchParams(path.split("?")[1] ?? "");
  const view = query.get("view") as CommandsView;
  return { view: VIEWS.includes(view) ? view : "main", q: query.get("q") ?? "" };
}

const Row: FC<{
  icon: ReactNode;
  label: ReactNode;
  sub?: ReactNode;
  right?: ReactNode;
  onRun: () => void;
  autoFocus?: boolean;
  disabled?: boolean;
}> = ({ icon, label, sub, right, onRun, autoFocus, disabled }) => (
  <Focusable
    className="dom-cmd"
    onActivate={disabled ? undefined : onRun}
    onClick={disabled ? undefined : onRun}
    {...({ autoFocus } as any)}
    style={{ ...s.row, padding: "9px 12px", marginBottom: "4px", opacity: disabled ? 0.5 : 1, cursor: "pointer" }}
  >
    <span style={{ fontSize: "22px", width: "30px", textAlign: "center", flexShrink: 0 }}>{icon}</span>
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={s.title}>{label}</div>
      {sub && <div style={{ ...s.subline, fontSize: "13px" }}>{sub}</div>}
    </div>
    {right && <div style={{ fontSize: "14px", opacity: 0.85, flexShrink: 0 }}>{right}</div>}
  </Focusable>
);

const Hint: FC<{ children: ReactNode }> = ({ children }) => (
  <div style={{ fontSize: "13px", opacity: 0.75, padding: "6px 4px" }}>{children}</div>
);

export const CommandsPage: FC = () => {
  const path = useSteamPath();
  const running = useRunningGame();
  const speech = useSpeechAllowed();
  const recording = useVoiceNoteRecording();
  const timers = useTimers();
  const { header, footer } = useChromeHeights();
  const [{ view, q: startQ }, setAddress] = useState(() => readAddress(path));
  const [query, setQuery] = useState(startQ);
  const [games, setGames] = useState<GameSummary[] | null>(null);
  const [controls, setControls] = useState<{ home: boolean; docker: boolean } | null>(null);
  const [listening, setListening] = useState(voiceBusy());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    ensureTheme();
    setNotesPageMounted(true);
    backend.listGames().then(setGames, () => setGames([]));
    backend.controlsStatus().then(setControls, () => setControls({ home: false, docker: false }));
    return () => setNotesPageMounted(false);
  }, []);

  // Opened again (combo, voice "search …") while already showing: take on the new address.
  useEffect(() => {
    const next = readAddress(path);
    setAddress(next);
    setQuery(next.q);
  }, [path]);

  const setView = (v: CommandsView) => {
    setAddress({ view: v, q: "" });
    setQuery("");
  };

  const lastPlayed = games && [...games].sort((a, b) => (b.lastLaunched ?? 0) - (a.lastLaunched ?? 0))[0];
  const gameId = running?.appId ?? deskGame.last ?? lastPlayed?.appId ?? null;
  const gameName = (id: string | null) =>
    !id ? null : id === running?.appId ? running.name : games?.find((g) => g.appId === id)?.name ?? id;

  const back = () => (view === "main" ? closeNotesPage() : setView("main"));

  /** Runs one thing, showing what went wrong instead of failing silently. */
  const attempt = async (what: string, fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toaster.toast({ title: what, body: errText(e) });
    } finally {
      setBusy(false);
    }
  };

  // ---- the commands themselves ----

  const needGame = (then: (appId: string) => void) => () => {
    if (gameId) return then(gameId);
    toaster.toast({ title: "Desk Commands", body: "Pick a game first." });
    setView("games");
  };

  const sayCommand = async () => {
    await toggleVoiceCommand();
    // listening → press again to finish; it also stops on its own after a while
    setListening(voiceBusy());
    const poll = setInterval(() => {
      if (!voiceBusy()) {
        setListening(false);
        clearInterval(poll);
      }
    }, 500);
  };

  const voiceNote = needGame((appId) =>
    attempt("Voice note", async () => {
      if (recording) return stopVoiceNote();
      const name = gameName(appId) ?? appId;
      await backend.ensureGame(appId, name);
      await startVoiceNote({ appId, name } as Game);
    })
  );

  /** Puts the palette away, grabs the game's screen, and opens a new note with it in the editor. */
  const screenshotNote = () => {
    const game = getRunningGame();
    if (!game) {
      toaster.toast({ title: "📸 Screenshot note", body: "Start a game first: it takes a screenshot of the game." });
      return;
    }
    closeNotesPage();
    (async () => {
      try {
        await sleep(700); // the palette has to be off screen first
        const problem = await backend.captureScreen();
        if (problem) throw new Error(problem);
        const shot = await backend.attachCaptured(game.appId);
        if (!shot) throw new Error("No screenshot was taken");
        await backend.ensureGame(game.appId, game.name);
        const when = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
        const note = await backend.saveNote(game.appId, {
          id: newId(),
          folderId: null,
          title: `📸 Screenshot · ${when}`,
          body: "",
          tags: [],
          screenshots: [shot],
          recordings: [],
          pinned: false,
          createdAt: 0,
          updatedAt: 0,
          launchNumber: null,
        });
        emitDataChanged();
        goEditNote(game.appId, note.id);
      } catch (e) {
        toaster.toast({ title: "📸 Screenshot note", body: errText(e) });
      } finally {
        backend.discardCaptured().catch(() => {});
      }
    })();
  };

  const runTyped = (text: string) =>
    attempt("Command failed", async () => {
      const g = getRunningGame() ?? (gameId ? { appId: gameId, name: gameName(gameId) ?? gameId } : null);
      await runCommand(text, g);
      setQuery("");
    });

  type Cmd = { id: string; icon: string; label: string; sub?: string; words: string; run: () => void; hide?: boolean };
  const commands: Cmd[] = [
    { id: "search", icon: "🔎", label: "Search notes", sub: "Every game's notes", words: "find look", run: () => setView("search") },
    {
      id: "new",
      icon: "📝",
      label: "New note",
      sub: gameId ? `For ${gameName(gameId)}` : "Pick a game",
      words: "write create add",
      run: needGame(goNewNote),
    },
    {
      id: "say",
      icon: "🗣",
      label: listening ? "Done talking" : "Say a command",
      sub: listening ? "Press again when you've finished" : '"Create a note called Nether Portal with coordinates 342, 71, -892"',
      words: "voice speak talk dictate",
      run: sayCommand,
      hide: !speech,
    },
    {
      id: "voice",
      icon: recording ? "⏹" : "🎙",
      label: recording ? "Stop recording" : "Voice note",
      sub: recording ? `Recording for ${recording.gameName}` : "Record audio into a new note",
      words: "record audio memo microphone",
      run: voiceNote,
    },
    {
      id: "shot",
      icon: "📸",
      label: "Screenshot note",
      sub: running ? `Screenshot of ${running.name} in a new note` : "Needs a game running",
      words: "screenshot picture capture",
      run: screenshotNote,
    },
    {
      id: "timer",
      icon: "⏱",
      label: "Start timer",
      sub: timers.length ? `${timers.length} running` : "Countdowns that ring over your game",
      words: "timer countdown alarm",
      run: () => setView("timer"),
    },
    { id: "dice", icon: "🎲", label: "Roll dice", sub: "d4 to d100, or flip a coin", words: "dice roll coin random", run: () => setView("dice") },
    {
      id: "home",
      icon: "🏠",
      label: "Home Assistant",
      sub: controls?.home ? "Lights, switches, scenes" : "Set up on the Desk server (admins)",
      words: "lights switch scene home",
      run: () => setView("home"),
    },
    {
      id: "docker",
      icon: "🐳",
      label: "Docker",
      sub: controls?.docker ? "Start, stop, restart containers" : "Set up on the Desk server (admins)",
      words: "containers server",
      run: () => setView("docker"),
    },
    {
      id: "notes",
      icon: "🎮",
      label: "Game notes",
      sub: gameId ? gameName(gameId) ?? undefined : "Pick a game",
      words: "notes game",
      run: () => (gameId ? goNotes(gameId) : setView("games")),
    },
    { id: "games", icon: "🗂", label: "Other games' notes", words: "library all games", run: () => setView("games") },
    { id: "desk", icon: "📚", label: "Desk", sub: "Your Tomes", words: "tomes widgets", run: () => goDesk(gameId) },
    { id: "web", icon: "🌐", label: "Browser", sub: "Back on the page you had open", words: "web internet browser", run: () => goWeb() },
  ];

  const q = query.trim().toLowerCase();
  const shown = commands.filter((c) => !c.hide && (!q || `${c.label} ${c.words}`.toLowerCase().includes(q)));

  const title: Record<CommandsView, string> = {
    main: "⚡ Desk Commands",
    search: "🔎 Search notes",
    timer: "⏱ Timers",
    dice: "🎲 Dice",
    home: "🏠 Home Assistant",
    docker: "🐳 Docker",
    games: "🎮 Games",
  };
  const placeholder: Record<CommandsView, string> = {
    main: "Type a command, or filter the list",
    search: "Words to find",
    timer: "Time, e.g. 7m or 1h 30m for bread",
    dice: "Dice, e.g. 3d8+2",
    home: "Filter",
    docker: "Filter",
    games: "Filter",
  };

  return (
    <div
      className="dom-root"
      style={{
        position: "absolute",
        inset: 0,
        paddingTop: `${header}px`,
        paddingBottom: `${footer}px`,
        background: "rgba(14,20,27,0.97)",
        boxSizing: "border-box",
        color: "#f2f4f7",
        display: "flex",
        justifyContent: "center",
      }}
    >
      <Focusable
        onCancelButton={back}
        onCancelActionDescription={view === "main" ? "Close" : "Back"}
        style={{ width: "min(760px, 100%)", padding: "14px 18px", boxSizing: "border-box", overflowY: "auto", height: "100%" }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: "12px", marginBottom: "8px" }}>
          <div style={{ fontSize: "20px", fontWeight: "bold" }}>{title[view]}</div>
          {view === "main" && gameId && <div style={{ fontSize: "13px", opacity: 0.7 }}>{gameName(gameId)}</div>}
          {busy && <div style={{ fontSize: "13px", opacity: 0.7 }}>Working…</div>}
        </div>
        <Focusable flow-children="row" style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "8px" }}>
          <div style={{ flex: 1 }}>
            <TextField value={query} onChange={(e) => setQuery(e.target.value)} {...({ placeholder: placeholder[view] } as any)} />
          </div>
          {view !== "main" && (
            <DialogButton style={s.smallButton} onClick={back}>
              Back
            </DialogButton>
          )}
        </Focusable>

        {view === "main" && (
          <>
            {q && (
              <Row
                icon="▶"
                label={`Run “${query.trim()}”`}
                sub="Same words as voice commands: note called … with …, roll 2d6, timer 5m, turn on …"
                onRun={() => runTyped(query.trim())}
              />
            )}
            {q && (
              <Row
                icon="🔎"
                label={`Search notes for “${query.trim()}”`}
                onRun={() => setAddress({ view: "search", q: query.trim() })}
              />
            )}
            {shown.map((c, i) => (
              <Row key={c.id} icon={c.icon} label={c.label} sub={c.sub} onRun={c.run} autoFocus={!q && i === 0} />
            ))}
          </>
        )}
        {view === "search" && <SearchView query={query} />}
        {view === "timer" && <TimerView query={query} clear={() => setQuery("")} timers={timers} />}
        {view === "dice" && <DiceView query={query} />}
        {view === "home" && <HomeView query={query} available={controls?.home} />}
        {view === "docker" && <DockerView query={query} available={controls?.docker} />}
        {view === "games" && (
          <GamesView query={query} games={games} running={running?.appId ?? null} />
        )}
      </Focusable>
    </div>
  );
};

// ---- the pages ----

const SearchView: FC<{ query: string }> = ({ query }) => {
  const [hits, setHits] = useState<NoteHit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const q = query.trim();
    if (!q) return setHits(null);
    const t = setTimeout(() => {
      backend.searchNotes(q).then(
        (h) => {
          setHits(h);
          setError(null);
        },
        (e) => setError(errText(e))
      );
    }, 250);
    return () => clearTimeout(t);
  }, [query]);
  if (error) return <Hint>{error}</Hint>;
  if (!query.trim()) return <Hint>Type above to search titles, text, tags and checklists in every game.</Hint>;
  if (!hits) return <Hint>Searching…</Hint>;
  if (!hits.length) return <Hint>No notes have all of those words.</Hint>;
  return (
    <>
      {hits.map((h) => (
        <Row
          key={`${h.appId}/${h.id}`}
          icon={kindInfo(h.kind).icon}
          label={h.title || "Untitled"}
          sub={`${h.gameName}${h.snippet ? ` · ${h.snippet}` : ""}`}
          onRun={() => goNote(h.appId, h.id)}
        />
      ))}
    </>
  );
};

const TimerView: FC<{ query: string; clear: () => void; timers: ReturnType<typeof useTimers> }> = ({ query, clear, timers }) => {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const typed = query.trim();
  const [, time, label] = typed.match(/^(.*?)(?:\s+(?:for|called)\s+(.+))?$/i) ?? [];
  const ms = typed ? parseDuration(time ?? typed) : null;
  const start = (m: number, l = "") => {
    startTimer(m, l);
    toaster.toast({ title: "⏱ Timer started", body: `${l ? `${l}: ` : ""}${formatDuration(m)}`, duration: 2500 });
  };
  return (
    <>
      {timers.map((t) => (
        <Row
          key={t.id}
          icon="⏳"
          label={formatDuration(t.endsAt - now)}
          sub={`${t.label === formatDuration(t.ms) ? `${t.label} timer` : t.label} · A stops it`}
          right="Stop"
          onRun={() => stopTimer(t.id)}
        />
      ))}
      {typed && (
        <Row
          icon="▶"
          label={ms ? `Start ${formatDuration(ms)}${label ? ` for ${label}` : ""}` : "Type a time, like 7m, 90s or 1h 30m"}
          disabled={!ms}
          onRun={() => {
            start(ms!, label ?? "");
            clear();
          }}
        />
      )}
      <Focusable flow-children="row" style={{ ...s.toolbar, marginTop: "8px" }}>
        {TIMER_PRESETS.map((m, i) => (
          <DialogButton key={m} style={s.smallButton} onClick={() => start(m * 60_000)} {...({ autoFocus: !timers.length && i === 2 } as any)}>
            {m < 60 ? `${m} min` : "1 hour"}
          </DialogButton>
        ))}
      </Focusable>
      <Hint>Timers keep running when this page closes, and ring over your game.</Hint>
    </>
  );
};

let rollHistory: Roll[] = [];

const DiceView: FC<{ query: string }> = ({ query }) => {
  const [history, setHistory] = useState(rollHistory);
  const roll = (spec: string) => {
    const r = rollDice(spec);
    if (!r) {
      toaster.toast({ title: "🎲 Dice", body: `Couldn't roll "${spec}". Try 2d6 or d20+3.` });
      return;
    }
    rollHistory = [r, ...rollHistory].slice(0, 12);
    setHistory(rollHistory);
  };
  const [latest, ...older] = history;
  return (
    <>
      <div style={{ textAlign: "center", padding: "10px 0 14px" }}>
        {latest ? (
          <>
            <div style={{ fontSize: "56px", fontWeight: "bold", lineHeight: 1.1 }}>{latest.text === "Coin" ? latest.detail : latest.total}</div>
            <div style={{ fontSize: "14px", opacity: 0.8 }}>
              {latest.text === "Coin" ? "🪙 Coin flip" : `${latest.text}${latest.detail ? ` · ${latest.detail}` : ""}`}
            </div>
          </>
        ) : (
          <div style={{ fontSize: "14px", opacity: 0.75 }}>Pick a die.</div>
        )}
      </div>
      <Focusable flow-children="row" style={s.toolbar}>
        {query.trim() && (
          <DialogButton style={s.primaryButton} onClick={() => roll(query.trim())}>
            Roll {query.trim()}
          </DialogButton>
        )}
        {DICE.map((d, i) => (
          <DialogButton key={d} style={s.smallButton} onClick={() => roll(d)} {...({ autoFocus: i === 5 } as any)}>
            {d === "coin" ? "🪙 Coin" : d}
          </DialogButton>
        ))}
      </Focusable>
      {older.length > 0 && <Hint>Earlier: {older.map(rollLabel).join(" · ")}</Hint>}
    </>
  );
};

const NotSetUp: FC<{ what: string; env: string }> = ({ what, env }) => (
  <Hint>
    {what} goes through your Desk server, and only for admins there. On the server, set {env} in the Desk of Madness compose
    file, then press Back and try again.
  </Hint>
);

const HOME_ICONS: Record<string, string> = {
  light: "💡",
  switch: "🔌",
  fan: "🌀",
  input_boolean: "🔘",
  scene: "🎬",
  script: "📜",
  automation: "🤖",
  cover: "🪟",
  media_player: "📺",
};

const HomeView: FC<{ query: string; available?: boolean }> = ({ query, available }) => {
  const [list, setList] = useState<HomeEntity[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => backend.homeList().then(setList, (e) => setError(errText(e)));
  useEffect(() => {
    if (available) load();
  }, [available]);
  if (available === false) return <NotSetUp what="Home Assistant" env="HA_URL and HA_TOKEN (a long-lived token from your HA profile)" />;
  if (error) return <Hint>{error}</Hint>;
  if (!list) return <Hint>Loading…</Hint>;
  const q = query.trim().toLowerCase();
  const shown = list.filter((e) => !q || `${e.name} ${e.id}`.toLowerCase().includes(q));
  const act = async (e: HomeEntity) => {
    try {
      const after = await backend.homeAction(e.id, "toggle");
      setList((l) => l && l.map((x) => (x.id === e.id ? { ...x, state: after.state } : x)));
      if (after.state == null) toaster.toast({ title: "🏠 Home Assistant", body: `Ran ${e.name}`, duration: 2500 });
    } catch (err) {
      toaster.toast({ title: e.name, body: errText(err) });
    }
  };
  return (
    <>
      {shown.map((e, i) => (
        <Row
          key={e.id}
          icon={HOME_ICONS[e.domain] ?? "🏠"}
          label={e.name}
          sub={e.id}
          right={e.state == null ? "Run" : e.state === "on" ? "🟢 On" : e.state === "off" ? "⚫ Off" : e.state}
          onRun={() => act(e)}
          autoFocus={i === 0 && !q}
        />
      ))}
      {!shown.length && <Hint>Nothing matches.</Hint>}
    </>
  );
};

const DockerView: FC<{ query: string; available?: boolean }> = ({ query, available }) => {
  const [list, setList] = useState<DockerContainer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const load = () => backend.dockerList().then(setList, (e) => setError(errText(e)));
  useEffect(() => {
    if (available) load();
  }, [available]);
  if (available === false) return <NotSetUp what="Docker" env="DOCKER_URL (the docker-proxy service)" />;
  if (error) return <Hint>{error}</Hint>;
  if (!list) return <Hint>Loading…</Hint>;
  const q = query.trim().toLowerCase();
  const shown = list.filter((c) => !q || `${c.name} ${c.image} ${c.project}`.toLowerCase().includes(q));
  const act = async (c: DockerContainer, action: "start" | "stop" | "restart") => {
    setWorking(`${c.name}:${action}`);
    try {
      const after = await backend.dockerAction(c.name, action);
      toaster.toast({ title: "🐳 Docker", body: `${c.name}: ${after.state}`, duration: 2500 });
      load();
    } catch (err) {
      toaster.toast({ title: c.name, body: errText(err) });
    } finally {
      setWorking(null);
    }
  };
  const btn = { ...s.smallButton, fontSize: "13px", padding: "4px 10px" };
  return (
    <>
      {shown.map((c) => {
        const up = c.state === "running";
        return (
          <Focusable key={c.name} flow-children="row" style={{ ...s.row, padding: "8px 12px", marginBottom: "4px" }}>
            <span style={{ fontSize: "14px" }}>{up ? "🟢" : c.state === "restarting" ? "🟡" : "⚫"}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={s.title}>{c.name}</div>
              <div style={{ ...s.subline, fontSize: "13px" }}>{c.status || c.state} · {c.image}</div>
            </div>
            {working?.startsWith(`${c.name}:`) ? (
              <span style={{ fontSize: "13px", opacity: 0.8 }}>Working…</span>
            ) : (
              <>
                <DialogButton style={btn} onClick={() => act(c, "restart")}>
                  Restart
                </DialogButton>
                <DialogButton style={btn} onClick={() => act(c, up ? "stop" : "start")}>
                  {up ? "Stop" : "Start"}
                </DialogButton>
              </>
            )}
          </Focusable>
        );
      })}
      {!shown.length && <Hint>Nothing matches.</Hint>}
    </>
  );
};

const GamesView: FC<{ query: string; games: GameSummary[] | null; running: string | null }> = ({ query, games, running }) => {
  if (!games) return <Hint>Loading…</Hint>;
  const q = query.trim().toLowerCase();
  const shown = [...games]
    .filter((g) => !q || g.name.toLowerCase().includes(q))
    .sort((a, b) => Number(b.appId === running) - Number(a.appId === running) || (b.lastLaunched ?? 0) - (a.lastLaunched ?? 0));
  return (
    <>
      {shown.map((g, i) => (
        <Row
          key={g.appId}
          icon="🎮"
          label={g.name}
          sub={g.appId === running ? "Playing now" : `${g.noteCount} note${g.noteCount === 1 ? "" : "s"}`}
          onRun={() => goNotes(g.appId)}
          autoFocus={i === 0 && !q}
        />
      ))}
      {!shown.length && <Hint>No games match.</Hint>}
    </>
  );
};
