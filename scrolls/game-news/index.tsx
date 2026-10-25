import { Context, ComponentType, CSSProperties, FC, ReactElement, ReactNode, useContext, useEffect, useState } from "react";
import { afterPatch, appDetailsClasses, createReactTreePatcher, DialogButton, ErrorBoundary, findInReactTree, Focusable, useParams } from "@decky/ui";
import type { DeskScrollApi } from "../../src/scrolls/api";
import type { TomeProps } from "../../src/tomes/registry";
import type { SteamNewsItem, WorkshopSummary } from "../../src/types";

// 📰 Game News: Steam's news for a game (plus new Workshop books for it) on its library page (a News tab, or a
// section under Play) and as a Tome.

interface NewsSettings {
  /** News on library pages. On unless turned off. */
  libraryPage?: boolean;
  /** As a News tab next to Steam's own (Activity, Your Stuff…) instead of a section under Play. On unless turned off. */
  asTab?: boolean;
  /** New Workshop books next to the news. On unless turned off. */
  workshop?: boolean;
  /** How many news posts to show; unset = 3 (8 in the News tab). */
  count?: number;
  /** App IDs the library section is hidden for. */
  hidden?: string[];
}

const SECTION_KEY = "desk-of-madness-game-news";
const TAB_ID = "DeskOfMadnessNews";
/** Steam's id for the game page's Activity tab; the News tab goes right after it. */
const ACTIVITY_TAB_ID = "WhatsNew";
const WORKSHOP_DAYS = 30;

type Tab = { id: string; title: string; content: ReactElement };
type TabsComponent = ComponentType<any>;

// The game page's tabs (Activity, Your Stuff, Community…) come from a component the page reads from a React
// context. A class between the page and the tabs redefines its render after the first call, so a tree patch
// through it only sees the first render; instead the page's output is wrapped in a nearer Provider of the same
// context, holding the original tabs component with its tab list patched. (The way Spool's Decky plugin does it.)
//
// The context is recognised by its default value, a fallback tabs component taking `setSections` and `concise`.
// Its module loads after Decky indexes Steam's modules, so this searches webpack's module factories directly.
// The default is read from `_currentValue2`: while the page renders, React DOM has the Provider's value in
// `_currentValue`, and Steam has no secondary renderer to touch `_currentValue2`.
function isTabsContext(e: any): e is Context<TabsComponent> {
  const fallback = e?._currentValue2;
  return (
    e?.$$typeof === Symbol.for("react.context") &&
    typeof fallback === "function" &&
    /setSections/.test(`${fallback}`) &&
    /concise/.test(`${fallback}`)
  );
}

/** Looked up once, on the first game page: undefined = not yet, null = not there (Steam changed). */
let tabsContext: Context<TabsComponent> | null | undefined;
function findTabsContext(log: (...a: unknown[]) => void): Context<TabsComponent> | null {
  if (tabsContext !== undefined) return tabsContext;
  tabsContext = null;
  try {
    let req: any;
    (window as any).webpackChunksteamui.push([[Symbol("desk-game-news")], {}, (r: any) => (req = r)]);
    for (const id of Object.keys(req?.m ?? {})) {
      const src = `${req.m[id]}`;
      if (!src.includes("createContext(") || !src.includes("concise") || !src.includes("setSections")) continue;
      const found = Object.values(req(id) ?? {}).find(isTabsContext);
      if (found) return (tabsContext = found);
    }
    log("game page tabs not found; showing News as a section");
  } catch (e) {
    log("looking for the game page tabs failed; showing News as a section", e);
  }
  return null;
}

function ago(ms: number): string {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 86400 * 30) return `${Math.round(s / 86400)} days ago`;
  return new Date(ms).toLocaleDateString();
}

export default function activate(desk: DeskScrollApi) {
  const settings = () => desk.settings.get<NewsSettings>();
  const useNewsSettings = () => desk.settings.use<NewsSettings>();

  /** News and fresh Workshop books for a game. */
  function useNews(appId: string | undefined, defaultCount = 3) {
    const s = useNewsSettings();
    const count = s.count ?? defaultCount;
    const [news, setNews] = useState<SteamNewsItem[] | null>(null);
    const [books, setBooks] = useState<WorkshopSummary[]>([]);
    const [error, setError] = useState<string | null>(null);
    useEffect(() => {
      if (!appId) return;
      let live = true;
      setNews(null);
      setError(null);
      desk
        .steamNews(appId, count)
        .then((n) => live && setNews(n))
        .catch((e) => live && (setError(String(e?.message ?? e)), setNews([])));
      if (s.workshop !== false) {
        desk
          .workshopEntries({ appId, sort: "new" })
          .then((list) => live && setBooks(list.filter((e) => e.createdAt > Date.now() - WORKSHOP_DAYS * 86400_000).slice(0, 2)))
          .catch(() => live && setBooks([]));
      } else setBooks([]);
      return () => {
        live = false;
      };
    }, [appId, count, s.workshop]);
    return { news, books, error };
  }

  const NewsRow: FC<{ item: SteamNewsItem; big?: boolean }> = ({ item, big }) => (
    <Focusable
      style={{ display: "flex", gap: "12px", padding: "8px", borderRadius: "4px", background: "rgba(255,255,255,0.04)", marginBottom: "6px" }}
      onActivate={() => desk.openUrl(item.url)}
      onClick={() => desk.openUrl(item.url)}
      onOKActionDescription="Read"
    >
      {big && item.image && (
        <img src={item.image} style={{ width: "128px", height: "60px", objectFit: "cover", borderRadius: "3px", flex: "0 0 auto" }} />
      )}
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: big ? "15px" : "14px", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {item.official ? "🛠 " : ""}
          {item.title}
        </div>
        <div style={{ fontSize: "12px", opacity: 0.6 }}>
          {ago(item.date)}
          {item.feed ? ` · ${item.feed}` : ""}
        </div>
        {big && item.summary && (
          <div style={{ fontSize: "13px", opacity: 0.8, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" } as CSSProperties}>
            {item.summary}
          </div>
        )}
      </div>
    </Focusable>
  );

  const BookRow: FC<{ book: WorkshopSummary; appId: string }> = ({ book, appId }) => (
    <Focusable
      style={{ display: "flex", gap: "10px", padding: "8px", borderRadius: "4px", background: "rgba(255,200,44,0.07)", marginBottom: "6px" }}
      onActivate={() => desk.openWorkshopEntry(book.id, appId)}
      onClick={() => desk.openWorkshopEntry(book.id, appId)}
      onOKActionDescription="Read"
    >
      <span>🏭</span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: "14px", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{book.title}</div>
        <div style={{ fontSize: "12px", opacity: 0.6 }}>
          New on the Madness Workshop · by {book.author.name} · {ago(book.createdAt)}
        </div>
      </div>
    </Focusable>
  );

  // ---- the library page section ----

  /** Whether the News tab is in use: wanted, and Steam's tabs were found. */
  const tabWanted = (s: NewsSettings) => s.asTab !== false && tabsContext !== null;

  const LibrarySection: FC = () => {
    const { appid } = useParams<{ appid: string }>() ?? ({} as { appid?: string });
    const s = useNewsSettings();
    const hidden = !appid || s.libraryPage === false || tabWanted(s) || (s.hidden ?? []).includes(appid);
    const { news, books, error } = useNews(hidden ? undefined : appid);
    if (hidden || (news && !news.length && !books.length && !error)) return null;
    const hide = () => desk.settings.set<NewsSettings>({ hidden: [...(settings().hidden ?? []), appid!] });
    return (
      <div style={{ margin: "12px 2.8vw", padding: "12px 16px", borderRadius: "6px", background: "rgba(14, 20, 27, 0.72)" }}>
        <Focusable flow-children="row" style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
          <div style={{ flex: 1, fontSize: "16px", fontWeight: "bold", letterSpacing: "0.04em", textTransform: "uppercase" }}>📰 News</div>
          <DialogButton style={{ width: "auto", minWidth: 0, padding: "4px 12px", fontSize: "12px", height: "28px", margin: 0 }} onClick={hide}>
            Hide for this game
          </DialogButton>
        </Focusable>
        {!news && <div style={{ fontSize: "13px", opacity: 0.6 }}>Loading news…</div>}
        {error && <div style={{ fontSize: "13px", opacity: 0.6 }}>⚠️ {error}</div>}
        {books.map((b) => (
          <BookRow key={b.id} book={b} appId={appid!} />
        ))}
        {news?.map((n) => (
          <NewsRow key={n.id} item={n} big />
        ))}
      </div>
    );
  };

  // ---- the News tab ----

  const NewsTab: FC<{ appid: string }> = ({ appid }) => {
    const { news, books, error } = useNews(appid, 8);
    const hide = () => desk.settings.set<NewsSettings>({ hidden: [...(settings().hidden ?? []), appid] });
    return (
      <div style={{ padding: "16px 0" }}>
        {!news && <div style={{ fontSize: "13px", opacity: 0.6 }}>Loading news…</div>}
        {error && <div style={{ fontSize: "13px", opacity: 0.6 }}>⚠️ {error}</div>}
        {news?.length === 0 && !books.length && !error && <div style={{ fontSize: "13px", opacity: 0.6 }}>No news for this game yet.</div>}
        {books.map((b) => (
          <BookRow key={b.id} book={b} appId={appid} />
        ))}
        {news?.map((n) => (
          <NewsRow key={n.id} item={n} big />
        ))}
        <Focusable flow-children="row" style={{ display: "flex", justifyContent: "flex-end", marginTop: "8px" }}>
          <DialogButton style={{ width: "auto", minWidth: 0, padding: "4px 12px", fontSize: "12px", height: "28px", margin: 0 }} onClick={hide}>
            Hide the News tab for this game
          </DialogButton>
        </Focusable>
      </div>
    );
  };

  /** Adds the News tab to the tab list the strip under Play is drawn from. */
  const tabListPatcher = createReactTreePatcher(
    [(t: any) => findInReactTree(t, (x: any) => x?.props?.fnOnCancelFromTabHeader)],
    (args: Array<Record<string, any>>, ret?: ReactElement) => {
      try {
        const strip = findInReactTree(ret, (x: any) => Array.isArray(x?.props?.tabs) && x.props.tabs.some((t: Tab) => t?.id));
        const appid = String((args[0]?.overview?.appid ?? 0) >>> 0);
        const s = settings();
        if (!strip || appid === "0" || s.libraryPage === false || s.asTab === false || (s.hidden ?? []).includes(appid)) return ret;
        const tabs: Tab[] = strip.props.tabs;
        if (tabs.some((t) => t?.id === TAB_ID)) return ret;
        const at = tabs.findIndex((t) => t?.id === ACTIVITY_TAB_ID) + 1 || tabs.length;
        const tab: Tab = {
          id: TAB_ID,
          title: "News",
          content: (
            <ErrorBoundary>
              <NewsTab appid={appid} />
            </ErrorBoundary>
          ),
        };
        // `tabs` is Steam's memoized array: hand the strip a copy rather than changing it.
        strip.props.tabs = [...tabs.slice(0, at), tab, ...tabs.slice(at)];
      } catch (e) {
        desk.log("adding the News tab failed", e);
      }
      return ret;
    },
    "DeskGameNewsTabs"
  );

  // One wrapper per original tabs component, so the Provider's value keeps its identity and the tabs never remount.
  const wrapped = new WeakMap<TabsComponent, TabsComponent>();
  function wrapTabs(Orig: TabsComponent): TabsComponent {
    if (typeof Orig !== "function" || Orig.prototype?.render) return Orig; // only a function component can be called inline
    let w = wrapped.get(Orig);
    if (!w) {
      const render = Orig as (props: any) => ReactElement;
      w = function DeskGameNewsAppDetailsTabs(props: any) {
        return tabListPatcher([props], render(props));
      };
      wrapped.set(Orig, w);
    }
    return w;
  }

  const TabsProvider: FC<{ context: Context<TabsComponent>; children: ReactNode }> = ({ context, children }) => {
    const Orig = useContext(context);
    return <context.Provider value={wrapTabs(Orig)}>{children}</context.Provider>;
  };

    // The same route patch Decky plugins use to add to the library page (e.g. ProtonDB Badges): find the page's
  // inner container as it renders and put the section right after the Play/Install bar.
  desk.patchRoute("/library/app/:appid", (tree: any) => {
    const routeProps = findInReactTree(tree, (x: any) => x?.renderFunc);
    if (routeProps) {
      const handler = createReactTreePatcher(
        [(t: any) => findInReactTree(t, (x: any) => x?.props?.children?.props?.overview)?.props?.children],
        (_: unknown, ret: any) => {
          const container = findInReactTree(
            ret,
            (x: any) => Array.isArray(x?.props?.children) && x?.props?.className?.includes(appDetailsClasses.InnerContainer)
          );
          if (typeof container === "object" && !container.props.children.some((c: any) => c?.key === SECTION_KEY)) {
            container.props.children.splice(
              1,
              0,
              <ErrorBoundary key={SECTION_KEY}>
                <LibrarySection />
              </ErrorBoundary>
            );
          }
          // The News tab. Always wrapped once the tabs are found (even when it's off), so turning it on or off
          // doesn't change the page's element types and remount it.
          const context = findTabsContext(desk.log);
          return context && ret ? <TabsProvider context={context}>{ret}</TabsProvider> : ret;
        }
      );
      afterPatch(routeProps, "renderFunc", handler);
    }
    return tree;
  });

  // ---- the Tome ----

  const NewsTome: FC<TomeProps> = ({ game }) => {
    const { news, books, error } = useNews(game?.appId);
    const { Hint } = desk.bits;
    if (!game) return null;
    return (
      <>
        {error && <Hint>⚠️ {error}</Hint>}
        {!news && !error && <Hint>Loading…</Hint>}
        {news?.length === 0 && !books.length && !error && <Hint>No news for {game.name}.</Hint>}
        {books.map((b) => (
          <BookRow key={b.id} book={b} appId={game.appId} />
        ))}
        {news?.map((n) => (
          <NewsRow key={n.id} item={n} />
        ))}
      </>
    );
  };
  desk.registerTome({
    id: "news",
    name: "Game News",
    icon: "📰",
    category: "gaming",
    description: "The game's latest Steam news and patch notes, and new Workshop books.",
    defaultOn: true,
    needsGame: true,
    component: NewsTome,
  });

  // ---- ⚙ Settings ----

  const SettingsPage: FC<{ closeModal?: () => void }> = ({ closeModal }) => {
    const { ModalRoot, ToggleField, Dropdown } = desk.ui;
    const s = useNewsSettings();
    const set = (patch: NewsSettings) => desk.settings.set<NewsSettings>(patch);
    const hidden = s.hidden ?? [];
    return (
      <ModalRoot onCancel={closeModal} closeModal={closeModal}>
        <h2 style={{ marginTop: 0 }}>📰 Game News</h2>
        <ToggleField
          label="News on library pages"
          description="Steam's news and patch notes on each game's page."
          checked={s.libraryPage !== false}
          onChange={(v) => set({ libraryPage: v })}
        />
        <ToggleField
          label="As a News tab"
          description="Next to Activity and Your Stuff under Play. Off: a News section right under Play instead."
          checked={s.asTab !== false}
          disabled={s.libraryPage === false}
          onChange={(v) => set({ asTab: v })}
        />
        <ToggleField
          label="New Workshop books"
          description={`Madness Workshop books for the game from the last ${WORKSHOP_DAYS} days, next to the news.`}
          checked={s.workshop !== false}
          onChange={(v) => set({ workshop: v })}
        />
        <div style={{ display: "flex", alignItems: "center", gap: "12px", margin: "10px 0" }}>
          <div style={{ flex: 1 }}>News posts to show</div>
          <div style={{ minWidth: "120px" }}>
            <Dropdown
              rgOptions={[2, 3, 5, 8].map((n) => ({ label: String(n), data: n }))}
              selectedOption={s.count ?? 3}
              onChange={(o: { data: number }) => set({ count: o.data })}
            />
          </div>
        </div>
        <div style={{ fontSize: "13px", opacity: 0.75, margin: "8px 0 4px" }}>
          Hidden for {hidden.length} {hidden.length === 1 ? "game" : "games"}
        </div>
        <Focusable flow-children="row" style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          {hidden.length > 0 && (
            <DialogButton style={{ width: "auto" }} onClick={() => set({ hidden: [] })}>
              Show it for every game again
            </DialogButton>
          )}
          <DialogButton style={{ width: "auto" }} onClick={() => closeModal?.()}>
            Close
          </DialogButton>
        </Focusable>
      </ModalRoot>
    );
  };
  desk.setSettingsPage(SettingsPage);
}
