import { CSSProperties, FC, ReactNode, useEffect, useState } from "react";
import { DialogButton, Focusable, GamepadButton, GamepadEvent, Menu, MenuItem, showContextMenu, showModal } from "@decky/ui";
import { FaArrowDown, FaArrowUp, FaCheck, FaExchangeAlt, FaPen, FaPlus, FaStickyNote, FaTrash } from "react-icons/fa";
import { backend } from "../api/backend";
import { useRunningGame } from "../hooks/useAppLifetime";
import { NotesProvider, useGame } from "../state/NotesProvider";
import { useDataVersion, useSettings } from "../state/notesStore";
import { getPlace, setPlace } from "../state/place";
import { rememberFolder } from "../state/resume";
import { deskGame } from "../state/deskGame";
import { DeskPage, Game, GameSummary } from "../types";
import { NoteList } from "../components/NoteList";
import { gameArt } from "../components/Library";
import { Loading, errorText } from "../components/Loading";
import { TileFrame, TomeFrame } from "./TomeFrame";
import { TomeList } from "./TomePicker";
import { Arranged, DeskAt, moveTome, resetGameLayout, setCollapsed, setTomeOn, setTomeSize, useArrangement, useForAllGames } from "./layout";
import { addPage, deletePage, GAME_PAGE, movePage, PAGE_ICONS, pagesOf, resetPages, savePage, setCurrentPage, useCurrentPage } from "./pages";
import { NameModal } from "../components/NameModal";
import { TomeProps } from "./registry";
import { Hint } from "./bits";
import "./builtin";
import * as s from "../components/styles";

// The Desk: the first tab. It has pages of Tomes (Today, Game, Trophies... your own). The game page follows the
// game you're playing (or the one you played last); every page's Tomes still know that game. On the
// full-screen page, R1 and L1 step through the pages.


type GoTab = TomeProps["goTab"];

export const Desk: FC<{ fullScreen: boolean; goTab: GoTab }> = ({ fullScreen, goTab }) => {
  const running = useRunningGame();
  const version = useDataVersion();
  const [games, setGames] = useState<GameSummary[] | null>(null);
  const [gamesError, setGamesError] = useState<string | null>(null);
  const [appId, setAppIdState] = useState<string | null>(() => {
    const p = getPlace();
    if (running && running.appId !== deskGame.followed) {
      deskGame.followed = running.appId;
      return running.appId;
    }
    return deskGame.last ?? (p.tab === "desk" ? p.appId : null) ?? running?.appId ?? null;
  });
  const [view, setViewState] = useState<"desk" | "notes">(() => getPlace().deskView ?? "desk");
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [managing, setManaging] = useState(false);
  const pageId = useCurrentPage(!!running);
  const pages = pagesOf(useSettings().desk);
  const page = pages.find((p) => p.id === pageId) ?? pages[0];
  const onGamePage = page.id === GAME_PAGE;

  const setAppId = (id: string | null) => {
    deskGame.last = id;
    setPlace({ appId: id, folderId: null, note: null, deskView: "desk" });
    setViewState("desk");
    setAppIdState(id);
  };
  const setView = (v: "desk" | "notes") => {
    setPlace({ deskView: v, ...(v === "desk" ? { folderId: null, note: null } : {}) });
    setViewState(v);
  };

  useEffect(() => setPlace({ appId, deskView: view }), []);
  const loadGames = () => {
    setGamesError(null);
    backend.listGames().then(setGames, (e) => {
      console.error("Desk of Madness: list_games failed", e);
      setGamesError(errorText(e));
    });
  };
  useEffect(loadGames, [version]);

  // A game starting takes over the Desk.
  useEffect(() => {
    if (running && running.appId !== deskGame.followed) {
      deskGame.followed = running.appId;
      setAppId(running.appId);
      setView("desk");
      setCurrentPage(GAME_PAGE);
    }
  }, [running?.appId]);

  // Nothing picked yet: the game played last.
  useEffect(() => {
    if (appId || !games?.length) return;
    const last = [...games].sort((a, b) => (b.lastLaunched ?? 0) - (a.lastLaunched ?? 0))[0];
    if (last) setAppId(last.appId);
  }, [games, appId]);

  const summary = games?.find((g) => g.appId === appId) ?? null;
  const live = !!running && running.appId === appId;

  const pickGame = () => {
    const recent = [...(games ?? [])]
      .filter((g) => g.launchCount > 0 || g.noteCount > 0)
      .sort((a, b) => (b.lastLaunched ?? 0) - (a.lastLaunched ?? 0))
      .slice(0, 12);
    showContextMenu(
      <Menu label="Show the Desk for">
        {running && (
          <MenuItem onSelected={() => setAppId(running.appId)}>
            ● {running.name} (playing)
          </MenuItem>
        )}
        {recent
          .filter((g) => g.appId !== running?.appId)
          .map((g) => (
            <MenuItem key={g.appId} onSelected={() => setAppId(g.appId)}>
              {g.name}
            </MenuItem>
          ))}
        <MenuItem onSelected={() => goTab("all")}>All games…</MenuItem>
      </Menu>
    );
  };

  if (view === "notes" && appId) {
    return (
      <NotesProvider key={appId} appId={appId}>
        <NoteList live={live} onBack={() => setView("desk")} backLabel="Desk" fullScreen={fullScreen} />
      </NotesProvider>
    );
  }

  const goPage = (id: string) => {
    setAdding(false);
    setManaging(false);
    setCurrentPage(id);
  };
  const header = (
    <>
      <PageBar pages={pages} current={page.id} fullScreen={fullScreen} onPick={goPage} />
      {onGamePage ? (
        <DeskHeader
          name={summary?.name ?? (games ? "No game yet" : "")}
          appId={appId}
          live={live}
          fullScreen={fullScreen}
          editing={editing}
          onPickGame={pickGame}
          onEdit={() => {
            setAdding(false);
            setEditing((e) => !e);
          }}
          onAdd={() => {
            setEditing(false);
            setAdding(true);
          }}
          onNotes={appId ? () => setView("notes") : undefined}
        />
      ) : (
        <PageActions
          fullScreen={fullScreen}
          editing={editing}
          onEdit={() => {
            setAdding(false);
            setEditing((e) => !e);
          }}
          onAdd={() => {
            setEditing(false);
            setAdding(true);
          }}
        />
      )}
      {editing && (
        <Focusable style={{ ...s.toolbar, marginTop: "-2px" }}>
          <DialogButton style={s.smallButton} onClick={() => setManaging((m) => !m)}>
            {managing ? "Hide pages" : "Pages…"}
          </DialogButton>
        </Focusable>
      )}
      {editing && managing && <PageManager current={page.id} />}
    </>
  );

  const at: DeskAt = { pageId: page.id, appId };
  const props = {
    onAdd: () => setAdding(true),
    live,
    fullScreen,
    editing,
    goTab,
    showNotes: (folderId?: string | null) => {
      if (!appId) return;
      rememberFolder(appId, folderId ?? null);
      setCurrentPage(GAME_PAGE);
      setView("notes");
    },
  };

  if (!games) return <Loading error={gamesError} onRetry={loadGames} what="your games" />;

  // R1 / L1 step through the pages on the full-screen page.
  const onButtonDown = (e: GamepadEvent) => {
    if (!fullScreen) return;
    if (e.detail.button === GamepadButton.BUMPER_RIGHT) goPage(stepTarget(pages, page.id, 1));
    else if (e.detail.button === GamepadButton.BUMPER_LEFT) goPage(stepTarget(pages, page.id, -1));
  };

  return (
    <Focusable onButtonDown={onButtonDown}>
      {header}
      {adding ? (
        <TomeList at={at} pageName={onGamePage ? undefined : page.name} gameName={summary?.name} onDone={() => setAdding(false)} />
      ) : appId ? (
        <NotesProvider key={appId} appId={appId}>
          <GameDesk at={at} appId={appId} {...props} />
        </NotesProvider>
      ) : (
        <>
          {onGamePage && (
            <div style={{ opacity: 0.75, fontSize: "14px", margin: "4px 0 12px" }}>
              Launch a game and the Desk fills in with its notes, checklists and counters.
            </div>
          )}
          <DeskStream at={at} appId={null} game={null} {...props} />
        </>
      )}
    </Focusable>
  );
};

const stepTarget = (pages: { id: string }[], current: string, by: 1 | -1) => {
  const i = pages.findIndex((p) => p.id === current);
  return pages[(i + by + pages.length) % pages.length].id;
};

const GameDesk: FC<Omit<StreamProps, "game">> = (props) => {
  const { game, error, refresh } = useGame();
  if (!game) return <Loading error={error} onRetry={refresh} what="this game's notes" />;
  return <DeskStream {...props} game={game} />;
};

// Compact mode: tighter Tomes and lines, so more fit in the Quick Access menu.
const COMPACT_CSS = `
.dom-compact .dom-tome { padding: 4px 8px !important; margin-bottom: 6px !important; }
.dom-compact .dom-line { padding: 4px 8px !important; margin-bottom: 2px !important; }
.dom-compact .dom-sub { display: none; }
`;

interface StreamProps extends Omit<TomeProps, "game" | "size"> {
  at: DeskAt;
  appId: string | null;
  game: Game | null;
  editing: boolean;
  onAdd: () => void;
}

/** Runs of Tomes drawn the same way: tiles side by side in a grid, cards stacked (in two columns full screen). */
function runs(items: Arranged[]) {
  const out: { size: "tile" | "card"; items: Arranged[] }[] = [];
  for (const x of items) {
    const last = out[out.length - 1];
    if (last && last.size === x.size) last.items.push(x);
    else out.push({ size: x.size, items: [x] });
  }
  return out;
}

/** The Tomes that are on, in order; in edit mode with buttons to move, resize and hide them. */
const DeskStream: FC<StreamProps> = ({ at, appId, game, editing, onAdd, ...rest }) => {
  const { items, own, perGame } = useArrangement(at);
  const compact = !!useSettings().desk?.compact;
  const on = items.filter((x) => x.on);
  const shown = on.filter((x) => editing || !(x.def.needsGame && !game) && !x.def.isEmpty?.(game));
  const first = shown[0]?.def.id;
  const last = shown[shown.length - 1]?.def.id;

  const body = (x: Arranged) => {
    const Tome = x.def.component;
    return x.def.needsGame && !game ? <Hint>Pick a game to use this Tome.</Hint> : <Tome {...rest} game={game} size={x.size} />;
  };
  const canBe = (x: Arranged, size: "tile" | "card") => (x.def.sizes ?? ["card"]).includes(size);

  return (
    <>
      {compact && <style>{COMPACT_CSS}</style>}
      <div className={compact ? "dom-compact" : undefined}>
        {runs(shown).map((run) =>
          run.size === "tile" ? (
            <div
              key={run.items[0].def.id}
              style={{
                display: "grid",
                gridTemplateColumns: `repeat(auto-fill, minmax(${rest.fullScreen ? 200 : 128}px, 1fr))`,
                gap: "8px",
                marginBottom: "10px",
              }}
            >
              {run.items.map((x) => (
                <TileFrame
                  key={x.def.id}
                  id={x.def.id}
                  editing={editing}
                  isFirst={x.def.id === first}
                  isLast={x.def.id === last}
                  canCard={canBe(x, "card")}
                  onOpen={x.def.onTileOpen ? () => x.def.onTileOpen!({ ...rest, game, size: "tile" }) : undefined}
                  onMove={(by) => moveTome(at, x.def.id, by)}
                  onCard={() => setTomeSize(at, x.def.id, "card")}
                  onHide={() => setTomeOn(at, x.def.id, false)}
                >
                  {body(x)}
                </TileFrame>
              ))}
            </div>
          ) : (
            <div key={run.items[0].def.id} style={rest.fullScreen && run.items.length > 1 ? { columnCount: 2, columnGap: "12px" } : undefined}>
              {run.items.map((x) => (
                <TomeFrame
                  key={x.def.id}
                  id={x.def.id}
                  icon={x.def.icon}
                  name={x.def.name}
                  collapsed={x.collapsed}
                  editing={editing}
                  isFirst={x.def.id === first}
                  isLast={x.def.id === last}
                  onToggle={() => setCollapsed(at, x.def.id, !x.collapsed)}
                  onMove={(by) => moveTome(at, x.def.id, by)}
                  onTile={canBe(x, "tile") ? () => setTomeSize(at, x.def.id, "tile") : undefined}
                  onHide={() => setTomeOn(at, x.def.id, false)}
                >
                  {body(x)}
                </TomeFrame>
              ))}
            </div>
          )
        )}
      </div>
      {shown.length === 0 && (
        <Focusable style={{ ...s.toolbar, marginTop: "4px" }}>
          <Hint>This page is empty. Tomes are its widgets: play time, achievements, notes, checklists, counters and more.</Hint>
          <DialogButton style={s.primaryButton} onClick={onAdd}>
            <FaPlus /> Add Tomes
          </DialogButton>
        </Focusable>
      )}
      {editing && at.pageId === GAME_PAGE && (
        <Focusable style={{ ...s.toolbar, marginTop: "4px", fontSize: "13px" }}>
          <div style={{ flex: "1 1 100%", opacity: 0.75 }}>
            {appId && perGame
              ? own
                ? `This layout is just for ${game?.name ?? "this game"}.`
                : `Changes make a layout just for ${game?.name ?? "this game"}.`
              : "This layout is used for every game."}
          </div>
          {appId && own && (
            <>
              <DialogButton style={s.smallButton} onClick={() => useForAllGames(appId)}>
                Use for all games
              </DialogButton>
              <DialogButton style={s.smallButton} onClick={() => resetGameLayout(appId)}>
                Reset to the all-games layout
              </DialogButton>
            </>
          )}
        </Focusable>
      )}
    </>
  );
};

// ---------- pages ----------

/** The page buttons. Full screen they carry the L1 / R1 hint. */
const PageBar: FC<{ pages: DeskPage[]; current: string; fullScreen: boolean; onPick: (id: string) => void }> = ({ pages, current, fullScreen, onPick }) => (
  <Focusable flow-children="row" style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "10px", overflowX: "auto" }}>
    {fullScreen && <span style={bumper}>L1</span>}
    {pages.map((p) => (
      <DialogButton
        key={p.id}
        onClick={() => onPick(p.id)}
        style={{
          ...s.smallButton,
          flex: fullScreen ? "1 1 0" : pages.length > 3 ? "0 0 auto" : "1 1 0",
          justifyContent: "center",
          height: "34px",
          minHeight: "34px",
          padding: "0 10px",
          fontSize: "13px",
          whiteSpace: "nowrap",
          fontWeight: p.id === current ? "bold" : undefined,
          ...(p.id === current ? s.tint("#7a4dd8") : {}),
        }}
      >
        {p.icon} {p.name}
      </DialogButton>
    ))}
    {fullScreen && <span style={bumper}>R1</span>}
  </Focusable>
);

const bumper = {
  flex: "0 0 auto",
  fontSize: "11px",
  fontWeight: "bold",
  padding: "3px 7px",
  borderRadius: "5px",
  border: "1px solid rgba(255,255,255,0.3)",
  opacity: 0.75,
} as const;

/** Add / Edit for pages other than the game page (which has them in its game header). */
const PageActions: FC<{ fullScreen: boolean; editing: boolean; onEdit: () => void; onAdd: () => void }> = ({ fullScreen, editing, onEdit, onAdd }) => (
  <Focusable flow-children="row" style={{ display: "flex", gap: "6px", marginBottom: "10px" }}>
    <DialogButton style={{ ...s.smallButton, flex: "1 1 0", justifyContent: "center", height: "36px", fontSize: "14px" }} onClick={onAdd}>
      <FaPlus /> Add Tomes
    </DialogButton>
    <DialogButton
      style={{ ...s.smallButton, flex: "1 1 0", justifyContent: "center", height: "36px", fontSize: "14px", ...(editing ? s.tint("#2d7d2d") : {}) }}
      onClick={onEdit}
    >
      {editing ? (
        <>
          <FaCheck /> Done
        </>
      ) : (
        <>
          <FaPen /> Edit{fullScreen ? " page" : ""}
        </>
      )}
    </DialogButton>
  </Focusable>
);

const iconBtn = { ...s.iconButton, width: "36px", minWidth: "36px", height: "32px", fontSize: "13px" };

/** Edit mode's page list: rename, pick an icon, reorder, delete, add. */
const PageManager: FC<{ current: string }> = ({ current }) => {
  const pages = pagesOf(useSettings().desk);
  const rename = (id: string, name: string) =>
    showModal(<NameModal heading="Page name" initial={name} onSubmit={(n) => savePage(id, { name: n.slice(0, 24) })} />);
  const pickIcon = (id: string) =>
    showContextMenu(
      <Menu label="Page icon">
        {PAGE_ICONS.map((icon) => (
          <MenuItem key={icon} onSelected={() => savePage(id, { icon })}>
            {icon}
          </MenuItem>
        ))}
      </Menu>
    );
  const add = () =>
    showModal(
      <NameModal
        heading="New page"
        onSubmit={(n) => setCurrentPage(addPage(n.slice(0, 24), PAGE_ICONS[pages.length % PAGE_ICONS.length]))}
      />
    );
  return (
    <div style={{ ...s.row, flexDirection: "column", alignItems: "stretch", padding: "8px", marginBottom: "10px", gap: "4px" }}>
      <div style={s.sectionLabel}>Pages</div>
      {pages.map((p, i) => (
        <Focusable key={p.id} flow-children="row" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <DialogButton style={iconBtn} onClick={() => pickIcon(p.id)} {...({ "aria-label": "Icon" } as any)}>
            {p.icon}
          </DialogButton>
          <DialogButton
            style={{ ...s.smallButton, flex: 1, minWidth: 0, height: "32px", fontWeight: p.id === current ? "bold" : undefined }}
            onClick={() => rename(p.id, p.name)}
          >
            {p.name}
            {p.id === GAME_PAGE && <span style={{ opacity: 0.6, fontWeight: "normal" }}> · follows the game</span>}
          </DialogButton>
          <DialogButton style={iconBtn} disabled={i === 0} onClick={() => movePage(p.id, -1)} {...({ "aria-label": "Move up" } as any)}>
            <FaArrowUp />
          </DialogButton>
          <DialogButton style={iconBtn} disabled={i === pages.length - 1} onClick={() => movePage(p.id, 1)} {...({ "aria-label": "Move down" } as any)}>
            <FaArrowDown />
          </DialogButton>
          <DialogButton
            style={iconBtn}
            disabled={p.id === GAME_PAGE}
            onClick={() => deletePage(p.id)}
            {...({ "aria-label": "Delete page" } as any)}
          >
            <FaTrash />
          </DialogButton>
        </Focusable>
      ))}
      <Focusable flow-children="row" style={{ display: "flex", gap: "6px", marginTop: "4px" }}>
        <DialogButton style={s.primaryButton} onClick={add}>
          <FaPlus /> New page
        </DialogButton>
        <DialogButton style={s.smallButton} onClick={() => resetPages()}>
          Starter pages
        </DialogButton>
      </Focusable>
    </div>
  );
};

const DeskHeader: FC<{
  name: string;
  appId: string | null;
  live: boolean;
  fullScreen: boolean;
  editing: boolean;
  onPickGame: () => void;
  onEdit: () => void;
  onAdd: () => void;
  onNotes?: () => void;
}> = ({ name, appId, live, fullScreen, editing, onPickGame, onEdit, onAdd, onNotes }) => {
  const art = appId ? gameArt(appId) : undefined;
  const actions: { label: string; icon: ReactNode; run: () => void; style?: CSSProperties }[] = [
    ...(onNotes ? [{ label: "Notes", icon: <FaStickyNote />, run: onNotes, style: s.tint("#1a9fff") }] : []),
    { label: "Game", icon: <FaExchangeAlt />, run: onPickGame },
    { label: "Add Tomes", icon: <FaPlus />, run: onAdd },
    editing
      ? { label: "Done", icon: <FaCheck />, run: onEdit, style: s.tint("#2d7d2d") }
      : { label: "Edit", icon: <FaPen />, run: onEdit },
  ];
  return (
    <div style={{ marginBottom: "10px" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          minHeight: fullScreen && art ? "70px" : undefined,
          padding: art ? "8px 10px" : 0,
          borderRadius: "8px",
          background: art ? `linear-gradient(90deg, rgba(14,20,27,0.92) 40%, rgba(14,20,27,0.55)), url("${art}") center/cover` : undefined,
        }}
      >
        <div style={{ ...s.title, fontSize: fullScreen ? "22px" : "18px", flex: 1 }}>{name}</div>
        {live && <span style={{ ...s.chip, background: "#2d7d2d", opacity: 1 }}>● Playing</span>}
      </div>
      {/* Labelled buttons, two to a line in the Quick Access menu. */}
      <Focusable style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "8px" }}>
        {actions.map((a) => (
          <DialogButton
            key={a.label}
            style={{
              ...s.smallButton,
              flex: fullScreen ? "1 1 0" : "1 1 40%",
              justifyContent: "center",
              height: "38px",
              fontSize: "14px",
              ...a.style,
            }}
            onClick={a.run}
          >
            {a.icon} {a.label}
          </DialogButton>
        ))}
      </Focusable>
    </div>
  );
};
