import { FC, useEffect, useState } from "react";
import { DialogButton, Focusable } from "@decky/ui";
import type { DeskScrollApi } from "../../src/scrolls/api";
import type { TomeProps } from "../../src/tomes/registry";
import type { WikiSite } from "../../src/types";
import { makeWiki, ROUTE, WikiSettings } from "./WikiPage";

// 📖 Wiki: a game's wiki in Desk's reader view, searchable, with parts of pages saved into notes.
// The page is WikiPage.tsx; this adds it, the Wiki Tome and the ⚙ Settings page.

export default function activate(desk: DeskScrollApi) {
  if (!desk.reader || !desk.wiki || !desk.notes || !desk.page) {
    desk.disable("This Desk is too old for the Wiki Scroll. Update Desk of Madness.");
    return;
  }
  const { WikiPage, openWiki, wikiFor, changeWikiModal: PickWiki, useWikis, setWikis, loadPicks, migrate, synced } = makeWiki(desk);
  desk.addRoute(ROUTE, WikiPage);
  migrate().catch(() => {}); // wikis picked on this Deck before picks were synced

  const host = (url: string) => url.replace(/^https?:\/\/(www\.)?/, "");

  // ---- the Tome ----

  const WikiTome: FC<TomeProps> = ({ game }) => {
    const s = desk.settings.use<WikiSettings>();
    const list = useWikis(game?.appId ?? "");
    const [found, setFound] = useState<WikiSite | null | undefined>(undefined);
    const [error, setError] = useState<string | null>(null);
    const { Line, Buttons, Btn, Hint } = desk.bits;
    const site = list[0] ?? found;
    useEffect(() => {
      if (!game || list.length) return;
      setFound(undefined);
      wikiFor(game.appId, game.name)
        .then(setFound)
        .catch((e) => setError(String(e?.message ?? e)));
    }, [game?.appId, list.length]);
    if (!game) return null;
    const t = { appId: game.appId, gameName: game.name };
    const search = async () => {
      const q = await desk.askText(`Search ${site?.name ?? "the wiki"}`);
      if (q?.trim()) openWiki({ ...t, view: { kind: "search", q: q.trim() } });
    };
    const recent = (s.recent?.[game.appId] ?? []).slice(0, 4);
    return (
      <>
        {error && <Hint>⚠️ {error}</Hint>}
        {site === undefined && !error && <Hint>Looking for {game.name}'s wiki…</Hint>}
        {site === null && <Hint>No wiki found for {game.name}. Pick one with Change wiki.</Hint>}
        {site && <Hint>📖 {site.name}{list.length > 1 ? ` · ${list.length - 1} more` : ""}</Hint>}
        {recent.map((r) => (
          <Line key={r.url} icon="📄" onOpen={() => openWiki({ ...t, view: { kind: "page", url: r.url } })} okLabel="Read">
            <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.title}</div>
          </Line>
        ))}
        <Buttons>
          {site && (
            <Btn primary onClick={search}>
              🔍 Search
            </Btn>
          )}
          {site && <Btn onClick={() => openWiki({ ...t, view: { kind: "page", url: site.home }, wiki: site.base })}>Main page</Btn>}
          {list.slice(1, 4).map((w) => (
            <Btn key={w.base} onClick={() => openWiki({ ...t, view: { kind: "page", url: w.home }, wiki: w.base })}>
              📖 {w.name}
            </Btn>
          ))}
          <Btn
            onClick={() =>
              desk.ui.showModal(
                <PickWiki
                  appId={game.appId}
                  gameName={game.name}
                  current={site ?? undefined}
                  onPicked={(w) => openWiki({ ...t, view: { kind: "page", url: w.home }, wiki: w.base })}
                />
              )
            }
          >
            {synced ? "Wikis…" : "Change wiki"}
          </Btn>
        </Buttons>
      </>
    );
  };
  desk.registerTome({
    id: "wiki",
    name: "Wiki",
    icon: "📖",
    category: "gaming",
    description: "The game's wiki: search it, read pages without ads, save parts into notes.",
    defaultOn: true,
    needsGame: true,
    component: WikiTome,
  });

  // ---- ⚙ Settings ----

  const SettingsPage: FC<{ closeModal?: () => void }> = ({ closeModal }) => {
    const { ModalRoot } = desk.ui;
    const [chosen, setChosen] = useState<[string, WikiSite[]][] | null>(null);
    const load = () =>
      loadPicks(true)
        .catch(() => loadPicks(false))
        .then(async () => {
          const all = synced ? await desk.wiki.picked!(false) : null;
          const s = desk.settings.get<WikiSettings>();
          setChosen(
            all
              ? Object.entries(all).filter(([, c]) => c.wikis.length).map(([id, c]) => [id, c.wikis])
              : Object.entries(s.wikis ?? {}).map(([id, w]) => [id, [w]])
          );
        })
        .catch(() => setChosen([]));
    useEffect(() => void load(), []);
    const forget = (appId: string) => setWikis(appId, []).then(load);
    const { Line, Hint } = desk.bits;
    const name = (appId: string) =>
      (window as any).appStore?.GetAppOverviewByAppID?.(Number(appId))?.display_name ?? (appId ? `App ${appId}` : "No game");
    return (
      <ModalRoot className="dom-modal" onCancel={closeModal} closeModal={closeModal}>
        <h2 style={{ marginTop: 0 }}>📖 Wiki</h2>
        <Hint>
          The wikis picked for each game{synced ? ", the same on your Desk website" : ""}. Press A to forget a game's wikis; Desk
          looks for one again next time.
        </Hint>
        <div style={{ maxHeight: "45vh", overflowY: "auto", margin: "8px 0" }}>
          {!chosen && <Hint>Loading…</Hint>}
          {chosen?.length === 0 && <Hint>None yet.</Hint>}
          {chosen?.map(([appId, ws]) => (
            <Line key={appId} icon="📖" onOpen={() => forget(appId)} okLabel="Forget">
              <div>{name(appId)}</div>
              <div style={{ fontSize: "12px", opacity: 0.6 }}>{ws.map((w) => w.name || host(w.base)).join(" · ")}</div>
            </Line>
          ))}
        </div>
        <Focusable flow-children="row" style={{ display: "flex", gap: "8px" }}>
          <DialogButton style={{ width: "auto" }} onClick={() => desk.settings.set<WikiSettings>({ recent: {} })}>
            Clear recent pages
          </DialogButton>
          <DialogButton style={{ width: "auto" }} onClick={() => closeModal?.()}>
            Close
          </DialogButton>
        </Focusable>
      </ModalRoot>
    );
  };
  desk.setSettingsPage(SettingsPage);
}
