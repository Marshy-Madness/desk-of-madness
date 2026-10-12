import { CSSProperties, FC, MouseEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  DialogButton,
  Focusable,
  GamepadButton,
  GamepadEvent,
  Menu,
  MenuItem,
  ModalRoot,
  showContextMenu,
  showModal,
  Spinner,
} from "@decky/ui";
import type { DeskScrollApi } from "../../src/scrolls/api";
import type { Note, ReaderPage, WikiResult, WikiSite } from "../../src/types";
import { Block, headingFor, sectionOf, toBlocks, toText } from "./blocks";
import * as s from "../../src/components/styles";

// The 📖 Wiki page: a game's wiki, read through Desk's reader view (the sync server fetches, cleans and keeps
// each page), searchable, with wiki links opening right here. "Select" picks headings (whole sections),
// paragraphs, lists and tables, and saves them to a new or existing note for the game.
//
// Buttons: B back · Y menu · X select parts (while selecting: add to a note) · L1 back · L2/R2 page up/down ·
// D-pad up/down scrolls (or moves between parts while selecting), left/right picks links, A opens the picked link
// (or picks/unpicks the part while selecting). Touch and the right trackpad work too.

export const ROUTE = "/desk-of-madness-wiki";

export interface WikiSettings {
  /** Before Desk synced picks (0.4.0-beta.3): the one wiki chosen for each game on this Deck. Used on older Desks,
   * and moved into the synced picks once. */
  wikis?: Record<string, WikiSite>;
  /** Recently read pages per game, newest first. */
  recent?: Record<string, { title: string; url: string }[]>;
  textSize?: number;
}

/** What the page shows. */
export type View = { kind: "page"; url: string } | { kind: "search"; q: string } | { kind: "pick" };

export interface Target {
  appId: string;
  gameName: string;
  view?: View;
  /** Which of the game's wikis (its base address); else the one the page is on, else the main one. */
  wiki?: string;
}

const RECENT_MAX = 10;
const MIN_ARTICLE = 120;
const pageCache = new Map<string, ReaderPage>();

let pending: Target | null = null;
let last: Target | null = null;

const SELECT_CSS = `
.dom-wiki .wk-block { border-left: 4px solid transparent; padding-left: 10px; margin-left: -14px; border-radius: 2px; }
.dom-wiki.wk-selecting .wk-block { cursor: pointer; }
.dom-wiki .wk-block.wk-on { border-left-color: #1a9fff; background: rgba(26,159,255,0.12); }
.dom-wiki .wk-block.wk-cursor { outline: 2px solid rgba(255,255,255,0.7); outline-offset: 2px; }
.dom-wiki .wk-block > :last-child { margin-bottom: 0.9em; }
.dom-wiki .sn-reader caption { font-weight: bold; padding: 0.3em 0; }
`;

/** The wiki in `list` that `url` is a page of. */
export function siteOf(list: WikiSite[], url: string): WikiSite | undefined {
  return list.find((w) => url.startsWith(w.articlePath.split("$1")[0])) ?? list.find((w) => url.startsWith(w.base + "/"));
}

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

export function makeWiki(desk: DeskScrollApi) {
  const settings = () => desk.settings.get<WikiSettings>();
  const set = (patch: WikiSettings) => desk.settings.set<WikiSettings>(patch);
  const toast = (title: string, body: string): void => void desk.decky.toaster.toast({ title, body });

  /** Opens the wiki page for a game (its chosen wiki's main page, a page, or a search). */
  function openWiki(t: Target) {
    pending = t;
    desk.showPage(ROUTE);
  }

  // ---------- the wikis picked for each game ----------
  // Synced with the server, so the website and other Decks use the same ones (Desk 0.4.0-beta.3 and later);
  // older Desks keep one wiki per game in this Scroll's settings. The first wiki is the game's main one.

  const synced = !!(desk.wiki.picked && desk.wiki.pick);
  let picks: Record<string, WikiSite[]> = {};
  let loadedAt = 0;
  const listeners = new Set<() => void>();
  const changed = () => listeners.forEach((fn) => fn());

  async function loadPicks(refresh = false) {
    if (!synced) {
      picks = Object.fromEntries(Object.entries(settings().wikis ?? {}).map(([id, w]) => [id, [w]]));
    } else {
      const all = await desk.wiki.picked!(refresh);
      picks = Object.fromEntries(Object.entries(all).map(([id, c]) => [id, c.wikis]));
    }
    loadedAt = Date.now();
    changed();
  }
  /** Fresh picks from the server at most every 30 seconds (the website may have changed them). */
  const freshen = () => {
    if (Date.now() - loadedAt > 30_000) loadPicks(true).catch(() => loadPicks(false).catch(() => {}));
  };

  async function setWikis(appId: string, list: WikiSite[]) {
    picks = { ...picks, [appId]: list };
    changed();
    if (synced) await desk.wiki.pick!(appId, list);
    else {
      const wikis = { ...settings().wikis };
      if (list.length) wikis[appId] = list[0];
      else delete wikis[appId];
      await set({ wikis });
    }
  }
  const wikisOf = (appId: string) => picks[appId] ?? [];
  /** Adds a wiki to a game (or moves it to the front with `main`). */
  const addWiki = (appId: string, w: WikiSite, main = false) => {
    const rest = wikisOf(appId).filter((x) => x.base !== w.base);
    return setWikis(appId, main || !synced ? [w, ...rest] : [...rest, w]);
  };

  /** React hook: a game's wikis, kept fresh. */
  function useWikis(appId: string): WikiSite[] {
    const [, bump] = useState(0);
    useEffect(() => {
      const fn = () => bump((n) => n + 1);
      listeners.add(fn);
      freshen();
      return () => void listeners.delete(fn);
    }, [appId]);
    return wikisOf(appId);
  }

  /** Moves the wikis picked on this Deck before picks were synced into the synced picks (once). */
  async function migrate() {
    const old = settings().wikis;
    if (!synced || !old || !Object.keys(old).length) return;
    const all = await desk.wiki.picked!(true);
    for (const [appId, w] of Object.entries(old)) if (!all[appId]?.wikis.length) await desk.wiki.pick!(appId, [w]);
    await set({ wikis: {} });
    await loadPicks(false);
  }

  /** The game's main wiki: the one picked before, else the best one found (remembered). */
  async function wikiFor(appId: string, gameName: string): Promise<WikiSite | null> {
    if (!loadedAt) await loadPicks(true).catch(() => loadPicks(false));
    const chosen = wikisOf(appId)[0];
    if (chosen) return chosen;
    if (!gameName) return null;
    const found = await desk.wiki.find(gameName);
    if (!found.length) return null;
    // Wikipedia is always found; a game wiki beats it, but it's better than nothing.
    await setWikis(appId, [found[0]]);
    return found[0];
  }

  function remember(appId: string, title: string, url: string) {
    const list = [{ title, url }, ...(settings().recent?.[appId] ?? []).filter((r) => r.url !== url)].slice(0, RECENT_MAX);
    set({ recent: { ...settings().recent, [appId]: list } });
  }

  /** A wiki page's title when `url` is a page on `site` (not a file, special or edit page). */
  function wikiTitle(site: WikiSite, url: string): string | null {
    const [prefix, suffix] = site.articlePath.split("$1");
    if (!url.startsWith(prefix)) return null;
    let rest = url.slice(prefix.length);
    if (suffix && rest.endsWith(suffix)) rest = rest.slice(0, -suffix.length);
    if (!rest || rest.includes("?")) return null;
    const title = decodeURIComponent(rest.split("#")[0]).replace(/_/g, " ");
    if (/^(File|Image|Special|Template|User|User talk|Talk|MediaWiki|Module|Help)\s*:/i.test(title)) return null;
    return title;
  }

  // ---------- picking a wiki ----------

  /** Adds a wiki to the game: one found by its name, or a typed address. */
  const AddWiki: FC<{ appId: string; gameName: string; current?: WikiSite; onPicked: (w: WikiSite) => void; closeModal?: () => void }> = ({
    appId,
    gameName,
    current,
    onPicked,
    closeModal,
  }) => {
    const have = useWikis(appId);
    const [found, setFound] = useState<WikiSite[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    useEffect(() => {
      if (!gameName) return setFound([]);
      desk.wiki
        .find(gameName)
        .then(setFound)
        .catch((e) => (setError(String(e?.message ?? e)), setFound([])));
    }, [gameName]);
    const pick = async (w: WikiSite) => {
      closeModal?.();
      onPicked(w);
      await addWiki(appId, w).catch((e) => toast("📖 Wiki", String(e?.message ?? e)));
    };
    const typed = async () => {
      const addr = await desk.askText("Wiki address", "e.g. eldenring.wiki.gg or a page on the wiki", current?.base ?? "");
      if (!addr) return;
      try {
        pick(await desk.wiki.site(addr));
      } catch (e: any) {
        toast("📖 Wiki", String(e?.message ?? e));
      }
    };
    const { Line, Hint } = desk.bits;
    return (
      <ModalRoot className="dom-modal" onCancel={closeModal} closeModal={closeModal}>
        <h2 style={{ marginTop: 0 }}>{synced && have.length ? "＋ Add a wiki" : "📖 Wiki"}{gameName ? ` for ${gameName}` : ""}</h2>
        {!found && <Hint>Looking for wikis…</Hint>}
        {error && <Hint>⚠️ {error}</Hint>}
        {found?.map((w) => (
          <Line
            key={w.home}
            icon={current?.base === w.base ? "✅" : have.some((x) => x.base === w.base) ? "☑️" : "📖"}
            onOpen={() => pick(w)}
            okLabel={have.some((x) => x.base === w.base) ? "Read this wiki" : synced && have.length ? "Add this wiki" : "Use this wiki"}
          >
            <div style={{ fontWeight: 600 }}>{w.name}</div>
            <div style={{ fontSize: "12px", opacity: 0.6 }}>{host(w.base)}</div>
          </Line>
        ))}
        {found && !found.length && !error && <Hint>No wiki found by name. Type its address instead.</Hint>}
        <Focusable flow-children="row" style={{ display: "flex", gap: "8px", marginTop: "10px" }}>
          <DialogButton style={s.smallButton} onClick={typed}>
            Type a wiki address…
          </DialogButton>
          <DialogButton style={s.smallButton} onClick={() => closeModal?.()}>
            Cancel
          </DialogButton>
        </Focusable>
      </ModalRoot>
    );
  };

  /** The game's wikis: read one, make one the main wiki, remove one, or add another. */
  const GameWikis: FC<{ appId: string; gameName: string; current?: WikiSite; onPicked: (w: WikiSite) => void; closeModal?: () => void }> = ({
    appId,
    gameName,
    current,
    onPicked,
    closeModal,
  }) => {
    const list = useWikis(appId);
    const { Line, Hint } = desk.bits;
    const fail = (e: any) => toast("📖 Wiki", String(e?.message ?? e));
    const read = (w: WikiSite) => (closeModal?.(), onPicked(w));
    const options = (w: WikiSite, i: number) =>
      showContextMenu(
        <Menu label={w.name}>
          <MenuItem onSelected={() => read(w)}>Read this wiki</MenuItem>
          {i > 0 && <MenuItem onSelected={() => addWiki(appId, w, true).catch(fail)}>Make it the main wiki</MenuItem>}
          <MenuItem tone="destructive" onSelected={() => setWikis(appId, list.filter((x) => x.base !== w.base)).catch(fail)}>
            Remove from {gameName || "this game"}
          </MenuItem>
        </Menu>
      );
    const add = () => showModal(<AddWiki appId={appId} gameName={gameName} current={current} onPicked={(w) => read(w)} />);
    return (
      <ModalRoot className="dom-modal" onCancel={closeModal} closeModal={closeModal}>
        <h2 style={{ marginTop: 0 }}>📖 Wikis{gameName ? ` for ${gameName}` : ""}</h2>
        <Hint>The first one is the main wiki: it opens first and the Wiki Tome searches it. Your Desk website uses the same ones.</Hint>
        <div style={{ maxHeight: "45vh", overflowY: "auto", margin: "8px 0" }}>
          {!list.length && <Hint>None picked yet.</Hint>}
          {list.map((w, i) => (
            <Line key={w.base} icon={current?.base === w.base ? "✅" : i === 0 ? "⭐" : "📖"} onOpen={() => options(w, i)} okLabel="Options">
              <div style={{ fontWeight: 600 }}>
                {w.name}
                {i === 0 && list.length > 1 ? " · main" : ""}
              </div>
              <div style={{ fontSize: "12px", opacity: 0.6 }}>{host(w.base)}</div>
            </Line>
          ))}
        </div>
        <Focusable flow-children="row" style={{ display: "flex", gap: "8px", marginTop: "10px" }}>
          <DialogButton style={s.primaryButton} onClick={add}>
            ＋ Add a wiki
          </DialogButton>
          <DialogButton style={s.smallButton} onClick={() => closeModal?.()}>
            Close
          </DialogButton>
        </Focusable>
      </ModalRoot>
    );
  };

  /** Where 📖 goes: the game's wikis, or straight to adding one on older Desks or when there are none. */
  const ChangeWiki: FC<{ appId: string; gameName: string; current?: WikiSite; onPicked: (w: WikiSite) => void; closeModal?: () => void }> = (props) =>
    synced && wikisOf(props.appId).length ? <GameWikis {...props} /> : <AddWiki {...props} />;

  // ---------- saving picked parts to a note ----------

  const SaveModal: FC<{
    appId: string;
    gameName: string;
    page: ReaderPage;
    text: string;
    suggested: string;
    onSaved: () => void;
    closeModal?: () => void;
  }> = ({ appId, gameName, page, text, suggested, onSaved, closeModal }) => {
    const [notes, setNotes] = useState<Note[] | null>(null);
    const [busy, setBusy] = useState(false);
    const [saved, setSaved] = useState<{ id: string; title: string } | null>(null);
    useEffect(() => {
      desk.notes
        .game(appId)
        .then((g) => setNotes([...g.notes].sort((a, b) => b.updatedAt - a.updatedAt)))
        .catch(() => setNotes([]));
    }, [appId]);
    const from = `— from “${page.title}” on ${page.site || host(page.url)}\n${page.url}`;

    const asNew = async () => {
      const title = await desk.askText("Note title", undefined, suggested);
      if (!title) return;
      setBusy(true);
      try {
        const n = await desk.notes.create(appId, gameName, { title: title.slice(0, 120), body: `${text}\n\n${from}`, tags: ["wiki"], kind: "guide" });
        setSaved({ id: n.id, title: n.title });
        onSaved();
      } catch (e: any) {
        toast("Couldn't save the note", String(e?.message ?? e));
      }
      setBusy(false);
    };
    const addTo = async (n: Note) => {
      setBusy(true);
      try {
        const body = n.body.replace(/\s+$/, "");
        await desk.notes.save(appId, { ...n, body: `${body ? body + "\n\n" : ""}${text}\n\n${from}` });
        setSaved({ id: n.id, title: n.title });
        onSaved();
      } catch (e: any) {
        toast("Couldn't add to the note", String(e?.message ?? e));
      }
      setBusy(false);
    };
    const { Line, Hint } = desk.bits;

    if (saved) {
      return (
        <ModalRoot className="dom-modal" onCancel={closeModal} closeModal={closeModal}>
          <h2 style={{ marginTop: 0 }}>✅ Saved to “{saved.title}”</h2>
          <Focusable flow-children="row" style={{ display: "flex", gap: "8px" }}>
            <DialogButton
              style={s.primaryButton}
              onClick={() => {
                closeModal?.();
                desk.notes.open(appId, saved.id).catch((e) => toast("📖 Wiki", String(e?.message ?? e)));
              }}
            >
              Open the note
            </DialogButton>
            <DialogButton style={s.smallButton} onClick={() => closeModal?.()}>
              Keep reading
            </DialogButton>
          </Focusable>
        </ModalRoot>
      );
    }
    return (
      <ModalRoot className="dom-modal" onCancel={closeModal} closeModal={closeModal}>
        <h2 style={{ marginTop: 0 }}>Add to a note</h2>
        <div
          style={{ fontSize: "13px", whiteSpace: "pre-wrap", maxHeight: "22vh", overflow: "hidden", opacity: 0.85, background: "rgba(0,0,0,0.25)", padding: "8px 10px", borderRadius: "4px", marginBottom: "10px", WebkitMaskImage: "linear-gradient(#000 70%, transparent)" } as CSSProperties}
        >
          {text.slice(0, 900)}
        </div>
        <Focusable flow-children="row" style={{ display: "flex", gap: "8px", marginBottom: "10px" }}>
          <DialogButton style={s.primaryButton} disabled={busy} onClick={asNew}>
            ＋ New note
          </DialogButton>
          <DialogButton style={s.smallButton} onClick={() => closeModal?.()}>
            Cancel
          </DialogButton>
        </Focusable>
        <div style={{ ...s.sectionLabel, margin: "6px 0" }}>Or add it to the end of</div>
        <div style={{ maxHeight: "34vh", overflowY: "auto" }}>
          {!notes && <Hint>Loading your notes…</Hint>}
          {notes?.length === 0 && <Hint>No notes for this game yet.</Hint>}
          {notes?.slice(0, 40).map((n) => (
            <Line key={n.id} icon={n.kind === "guide" ? "📘" : "📝"} onOpen={busy ? undefined : () => addTo(n)} okLabel="Add here">
              <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{n.title || "Untitled"}</div>
            </Line>
          ))}
        </div>
      </ModalRoot>
    );
  };

  // ---------- the page ----------

  const WikiPage: FC = () => {
    desk.page.useDeskPage();
    const { header, footer } = desk.page.useChromeHeights();
    const target = useMemo<Target>(() => {
      const t = pending ?? last ?? { appId: desk.runningGame()?.appId ?? "", gameName: desk.runningGame()?.name ?? "" };
      pending = null;
      return t;
    }, []);
    const { appId, gameName } = target;
    const conf = desk.settings.use<WikiSettings>();
    const textSize = conf.textSize ?? 17;

    const gameWikis = useWikis(appId);
    const startUrl = target.view?.kind === "page" ? target.view.url : "";
    const [site, setSite] = useState<WikiSite | null>(
      (target.wiki && gameWikis.find((w) => w.base === target.wiki)) || (startUrl && siteOf(gameWikis, startUrl)) || gameWikis[0] || null
    );
    const [view, setView] = useState<View | null>(target.view ?? null);
    const history = useRef<View[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [page, setPage] = useState<ReaderPage | null>(null);
    const [results, setResults] = useState<WikiResult[] | null>(null);
    const [selecting, setSelecting] = useState(false);
    const [picked, setPicked] = useState<Set<number>>(new Set());
    const [cursor, setCursor] = useState(0);
    const [link, setLink] = useState<HTMLAnchorElement | null>(null);
    const scroller = useRef<HTMLDivElement>(null);
    const viewRef = useRef(view);
    viewRef.current = view;

    // Where we are, for coming back with the combo or the radial.
    useEffect(() => {
      last = { appId, gameName, view: view ?? undefined, wiki: site?.base };
    }, [view, site?.base]);
    // A wiki removed from the game (here or on another device) while reading it: back to the main one.
    useEffect(() => {
      if (site && gameWikis.length && !gameWikis.some((w) => w.base === site.base) && synced) {
        setSite(gameWikis[0]);
        history.current = [];
        setView({ kind: "page", url: gameWikis[0].home });
      }
    }, [gameWikis.map((w) => w.base).join(" ")]);

    // The wiki: the game's chosen one, else find one. Without a game or a wiki, ask.
    useEffect(() => {
      if (site) {
        if (!viewRef.current) setView({ kind: "page", url: site.home });
        return;
      }
      setLoading(true);
      wikiFor(appId, gameName)
        .then((main) => {
          const list = wikisOf(appId);
          const w = (target.wiki && list.find((x) => x.base === target.wiki)) || (startUrl && siteOf(list, startUrl)) || main;
          if (w) {
            setSite(w);
            if (!viewRef.current) setView({ kind: "page", url: w.home });
          } else changeWiki();
        })
        .catch((e) => setError(String(e?.message ?? e)))
        .finally(() => setLoading(false));
    }, []);

    const go = (v: View) => {
      if (viewRef.current) history.current.push(viewRef.current);
      setView(v);
    };
    const back = () => {
      if (selecting) return leaveSelect();
      const prev = history.current.pop();
      if (prev) setView(prev);
      else desk.page.close();
    };
    const readWiki = (w: WikiSite) => {
      if (w.base === site?.base && view) return;
      setSite(w);
      history.current = [];
      setView({ kind: "page", url: w.home });
    };
    const changeWiki = () => showModal(<ChangeWiki appId={appId} gameName={gameName} current={site ?? undefined} onPicked={readWiki} />);
    const search = async () => {
      const q = await desk.askText(`Search ${site?.name ?? "the wiki"}`, undefined, view?.kind === "search" ? view.q : "");
      if (q?.trim()) go({ kind: "search", q: q.trim() });
    };

    // ---- loading what the view shows ----

    useEffect(() => {
      if (!view || view.kind === "pick") return;
      let gone = false;
      setError(null);
      setSelecting(false);
      setPicked(new Set());
      setLink(null);
      if (view.kind === "search") {
        if (!site) return;
        setLoading(true);
        setResults(null);
        desk.wiki
          .search(site.base, view.q)
          .then((r) => !gone && setResults(r))
          .catch((e) => !gone && setError(String(e?.message ?? e)))
          .finally(() => !gone && setLoading(false));
      } else {
        const cached = pageCache.get(view.url);
        if (cached) {
          setPage(cached);
          scroller.current?.scrollTo({ top: 0 });
          return;
        }
        setLoading(true);
        desk.reader
          .page(view.url)
          .then((p) => {
            if (gone) return;
            if (p.length < MIN_ARTICLE) throw new Error("This page has hardly any text. Try searching instead.");
            pageCache.set(view.url, p);
            setPage(p);
            remember(appId, p.title || host(p.url), view.url);
            scroller.current?.scrollTo({ top: 0 });
          })
          .catch((e) => !gone && (setError(String(e?.message ?? e)), setPage(null)))
          .finally(() => !gone && setLoading(false));
      }
      return () => {
        gone = true;
      };
    }, [view, site?.base]);

    const blocks = useMemo<Block[]>(() => (page ? toBlocks(page.html) : []), [page]);
    const rendered = useMemo(() => blocks.map((b) => desk.reader.elements(b.html)), [blocks]);

    // ---- links ----

    const follow = (url: string) => {
      if (site && wikiTitle(site, url)) return go({ kind: "page", url });
      const other = siteOf(gameWikis, url); // a link to another of the game's wikis opens here too
      if (other && wikiTitle(other, url)) {
        setSite(other);
        return go({ kind: "page", url });
      }
      desk.openUrl(url);
    };

    const visibleLinks = (): HTMLAnchorElement[] => {
      const box = scroller.current?.getBoundingClientRect();
      if (!box) return [];
      return Array.from(scroller.current!.querySelectorAll<HTMLAnchorElement>("a[data-href]")).filter((a) => {
        const r = a.getBoundingClientRect();
        return r.bottom > box.top + 4 && r.top < box.bottom - 4 && r.width > 0;
      });
    };
    useEffect(() => {
      link?.classList.add("sn-picked");
      link?.scrollIntoView({ block: "nearest" });
      return () => link?.classList.remove("sn-picked");
    }, [link]);
    const pickLink = (step: 1 | -1) => {
      const links = visibleLinks();
      if (!links.length) return;
      const i = link ? links.indexOf(link) : -1;
      setLink(links[i < 0 ? (step > 0 ? 0 : links.length - 1) : (i + step + links.length) % links.length]);
    };
    const linksMenu = () => {
      const links = visibleLinks();
      if (!links.length) return toast("No links here", "Scroll to a link, or tap it.");
      showContextMenu(
        <Menu label="Links on screen">
          {links.slice(0, 15).map((a, i) => (
            <MenuItem key={i} onSelected={() => follow(a.dataset.href!)}>
              {(a.textContent || a.dataset.href!).trim().slice(0, 70)}
            </MenuItem>
          ))}
        </Menu>
      );
    };

    // ---- selecting parts ----

    const blockEl = (i: number) => scroller.current?.querySelector<HTMLElement>(`[data-block="${i}"]`);
    const firstVisibleBlock = () => {
      const box = scroller.current?.getBoundingClientRect();
      if (!box) return 0;
      const i = blocks.findIndex((_, j) => (blockEl(j)?.getBoundingClientRect().bottom ?? 0) > box.top + 8);
      return Math.max(0, i);
    };
    const enterSelect = () => {
      if (!blocks.length) return;
      setLink(null);
      setCursor(firstVisibleBlock());
      setSelecting(true);
    };
    const leaveSelect = () => setSelecting(false);
    useEffect(() => {
      if (selecting) blockEl(cursor)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }, [cursor, selecting]);

    const toggle = (i: number) =>
      setPicked((old) => {
        const next = new Set(old);
        const group = sectionOf(blocks, i);
        const on = !old.has(i);
        group.forEach((j) => (on ? next.add(j) : next.delete(j)));
        return next;
      });

    const save = () => {
      const idx = [...picked].sort((a, b) => a - b);
      if (!page || !idx.length) return toast("📖 Wiki", "Pick some parts first: move with the D-pad and press A (or tap them).");
      const text = toText(idx.map((i) => blocks[i]));
      const sub = headingFor(blocks, idx[0]);
      const suggested = sub && sub !== page.title && blocks[idx[0]].level ? `${page.title}: ${sub}` : page.title;
      showModal(
        <SaveModal
          appId={appId}
          gameName={gameName}
          page={page}
          text={text}
          suggested={suggested}
          onSaved={() => {
            setPicked(new Set());
            setSelecting(false);
          }}
        />
      );
    };

    // ---- buttons ----

    const scrollBy = (fraction: number) => {
      const el = scroller.current;
      if (el) el.scrollBy({ top: el.clientHeight * fraction, behavior: "smooth" });
    };
    const onDirection = (evt: GamepadEvent) => {
      const el = scroller.current;
      const b = evt.detail.button;
      if (selecting) {
        if (b === GamepadButton.DIR_UP) {
          if (cursor === 0) return false;
          setCursor(cursor - 1);
          return;
        }
        if (b === GamepadButton.DIR_DOWN) return void setCursor(Math.min(blocks.length - 1, cursor + 1));
        return false;
      }
      switch (b) {
        case GamepadButton.DIR_UP:
          if (!el || el.scrollTop <= 2) return false; // at the top: up moves to the toolbar
          scrollBy(-0.45);
          return;
        case GamepadButton.DIR_DOWN:
          scrollBy(0.45);
          return;
        case GamepadButton.DIR_LEFT:
          pickLink(-1);
          return;
        case GamepadButton.DIR_RIGHT:
          pickLink(1);
          return;
      }
      return false;
    };
    const onActivate = () => {
      if (selecting) return toggle(cursor);
      if (link?.dataset.href) follow(link.dataset.href);
      else linksMenu();
    };
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (selecting) {
        e.preventDefault();
        const b = target.closest?.("[data-block]") as HTMLElement | null;
        if (b) {
          const i = Number(b.dataset.block);
          setCursor(i);
          toggle(i);
        }
        return;
      }
      const a = target.closest?.("a[data-href]") as HTMLAnchorElement | null;
      if (!a) return;
      e.preventDefault();
      follow(a.dataset.href!);
    };
    const onButtonDown = (evt: GamepadEvent) => {
      switch (evt.detail.button) {
        case GamepadButton.BUMPER_LEFT:
          return back();
        case GamepadButton.TRIGGER_LEFT:
          return scrollBy(-0.9);
        case GamepadButton.TRIGGER_RIGHT:
          return scrollBy(0.9);
      }
    };

    const menu = () => {
      const isPage = view?.kind === "page" && page;
      showContextMenu(
        <Menu label={site?.name ?? "Wiki"}>
          <MenuItem onSelected={search}>Search the wiki…</MenuItem>
          {site && <MenuItem onSelected={() => go({ kind: "page", url: site.home })}>Main page</MenuItem>}
          {isPage && <MenuItem onSelected={selecting ? leaveSelect : enterSelect}>{selecting ? "Stop selecting" : "Select parts for a note"}</MenuItem>}
          {isPage && <MenuItem onSelected={() => (setPicked(new Set(blocks.map((_, i) => i))), setSelecting(true))}>Select the whole page</MenuItem>}
          {picked.size > 0 && <MenuItem onSelected={save}>Add {picked.size} picked parts to a note…</MenuItem>}
          {picked.size > 0 && <MenuItem onSelected={() => setPicked(new Set())}>Unpick everything</MenuItem>}
          {isPage && <MenuItem onSelected={() => desk.openUrl(page!.url)}>Open in Desk's browser</MenuItem>}
          {gameWikis.length > 1 &&
            gameWikis
              .filter((w) => w.base !== site?.base)
              .map((w) => (
                <MenuItem key={w.base} onSelected={() => readWiki(w)}>
                  📖 Read {w.name}
                </MenuItem>
              ))}
          <MenuItem onSelected={changeWiki}>{synced ? "Wikis for this game…" : "Change wiki…"}</MenuItem>
          <MenuItem onSelected={() => set({ textSize: Math.min(28, textSize + 2) })}>Bigger text</MenuItem>
          <MenuItem onSelected={() => set({ textSize: Math.max(12, textSize - 2) })}>Smaller text</MenuItem>
          <MenuItem tone="destructive" onSelected={() => desk.page.close()}>
            Close the wiki
          </MenuItem>
        </Menu>
      );
    };

    // ---- drawing ----

    const isPage = view?.kind === "page";
    const title = isPage ? page?.title : view?.kind === "search" ? `“${view.q}”` : "";
    return (
      <Focusable
        className={`dom-root dom-wiki${selecting ? " wk-selecting" : ""}`}
        style={{ position: "absolute", inset: 0, paddingTop: `${header}px`, paddingBottom: `${footer}px`, display: "flex", flexDirection: "column", boxSizing: "border-box" }}
        onCancelButton={back}
        onCancelActionDescription={selecting ? "Stop selecting" : history.current.length ? "Back" : "Close"}
        onSecondaryButton={isPage && page ? (selecting ? save : enterSelect) : search}
        onSecondaryActionDescription={isPage && page ? (selecting ? `Add to note${picked.size ? ` (${picked.size})` : ""}` : "Select parts") : "Search"}
        onOptionsButton={menu}
        onOptionsActionDescription="Menu"
        onButtonDown={onButtonDown}
      >
        <style>{desk.reader.css + SELECT_CSS}</style>
        <Focusable flow-children="row" style={{ display: "flex", alignItems: "center", gap: "6px", padding: "6px 12px", flex: "0 0 auto" }}>
          <Tool onClick={back} label="Back">←</Tool>
          <DialogButton
            onClick={changeWiki}
            style={{ ...s.smallButton, flex: "0 1 auto", minWidth: 0, maxWidth: "30%", overflow: "hidden", textOverflow: "ellipsis" }}
          >
            📖 {site?.name ?? "Wiki"}
          </DialogButton>
          <div style={{ flex: "1 1 auto", minWidth: 0, fontSize: "14px", opacity: 0.8, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {title}
          </div>
          <Tool onClick={search} label="Search" wide>🔍 Search</Tool>
          {isPage && page && (
            <Tool onClick={selecting ? save : enterSelect} label="Select" wide primary={selecting}>
              {selecting ? `＋ Add ${picked.size || ""} to note` : "✂ Select"}
            </Tool>
          )}
          <Tool onClick={menu} label="Menu">☰</Tool>
          <Tool onClick={() => desk.page.close()} label="Close">✕</Tool>
        </Focusable>

        {selecting && (
          <div style={{ fontSize: "13px", padding: "0 16px 6px", opacity: 0.85 }}>
            ✂ D-pad to move, A to pick (a heading picks its whole section), X to add {picked.size} picked to a note, B to stop.
          </div>
        )}

        <Focusable
          ref={scroller}
          onActivate={onActivate}
          onOKActionDescription={selecting ? (picked.has(cursor) ? "Unpick" : "Pick") : link ? "Open link" : "Links"}
          onGamepadDirection={onDirection as any}
          onScroll={() => link && !visibleLinks().includes(link) && setLink(null)}
          onClick={onClick}
          noFocusRing
          preferredFocus
          style={{ flex: "1 1 auto", overflowY: "auto", padding: "8px 24px 40px" }}
        >
          <div style={{ maxWidth: "820px", margin: "0 auto", fontSize: `${textSize}px` }}>
            {loading && <Spinner style={{ width: "40px", margin: "40px auto", display: "block" }} />}
            {error && !loading && (
              <div style={{ padding: "24px 0", fontSize: "15px" }}>
                ⚠️ {error}
                <Hint>Press X to search{site ? ` ${site.name}` : ""}, or Y for the menu (other wikis).</Hint>
              </div>
            )}

            {!loading && view?.kind === "search" && results && (
              <>
                <h2 style={{ margin: "0 0 12px" }}>
                  {results.length ? `Results for “${view.q}”` : `Nothing on ${site?.name} for “${view.q}”`}
                </h2>
                {results.map((r) => (
                  <ResultRow key={r.url} r={r} onOpen={() => go({ kind: "page", url: r.url })} />
                ))}
              </>
            )}

            {isPage && page && !error && (
              <div style={{ opacity: loading ? 0.5 : 1 }}>
                <div style={{ fontSize: "0.8em", opacity: 0.65, marginBottom: "4px" }}>
                  {page.site}
                  {page.cached && " · saved copy"}
                </div>
                <h1 style={{ fontSize: "1.7em", lineHeight: 1.2, margin: "0 0 0.6em" }}>{page.title}</h1>
                <div className="sn-reader">
                  {rendered.map((el, i) => (
                    <div
                      key={i}
                      data-block={i}
                      className={`wk-block${picked.has(i) ? " wk-on" : ""}${selecting && cursor === i ? " wk-cursor" : ""}`}
                    >
                      {el}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Focusable>
      </Focusable>
    );
  };

  const Hint: FC<{ children: ReactNode }> = ({ children }) => <div style={{ fontSize: "13px", opacity: 0.7, marginTop: "8px" }}>{children}</div>;

  const ResultRow: FC<{ r: WikiResult; onOpen: () => void }> = ({ r, onOpen }) => (
    <Focusable
      style={{ ...s.row, display: "block", cursor: "pointer" }}
      onActivate={onOpen}
      onClick={onOpen}
      onOKActionDescription="Read"
    >
      <div style={{ fontWeight: 600, fontSize: "1em" }}>{r.title}</div>
      {r.snippet && <div style={{ fontSize: "0.8em", opacity: 0.7, marginTop: "2px" }}>{r.snippet}</div>}
    </Focusable>
  );

  const Tool: FC<{ onClick: () => void; label: string; wide?: boolean; primary?: boolean; children: ReactNode }> = ({ onClick, label, wide, primary, children }) => (
    <DialogButton
      aria-label={label}
      onClick={onClick}
      style={{ ...(primary ? s.primaryButton : s.smallButton), flex: "0 0 auto", width: wide ? "auto" : "44px", minWidth: wide ? 0 : "44px", padding: wide ? "0 12px" : 0, justifyContent: "center", height: "40px" }}
    >
      {children}
    </DialogButton>
  );

  return { WikiPage, openWiki, wikiFor, changeWikiModal: ChangeWiki, useWikis, setWikis, loadPicks, migrate, synced };
}
