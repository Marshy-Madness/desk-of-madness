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
  const { WikiPage, openWiki, wikiFor, changeWikiModal: PickWiki } = makeWiki(desk);
  desk.addRoute(ROUTE, WikiPage);

  // ---- the Tome ----

  const WikiTome: FC<TomeProps> = ({ game }) => {
    const s = desk.settings.use<WikiSettings>();
    const [site, setSite] = useState<WikiSite | null | undefined>(game ? s.wikis?.[game.appId] : undefined);
    const [error, setError] = useState<string | null>(null);
    const { Line, Buttons, Btn, Hint } = desk.bits;
    useEffect(() => {
      if (!game) return;
      const chosen = s.wikis?.[game.appId];
      if (chosen) return setSite(chosen);
      setSite(undefined);
      wikiFor(game.appId, game.name)
        .then(setSite)
        .catch((e) => setError(String(e?.message ?? e)));
    }, [game?.appId, s.wikis?.[game?.appId ?? ""]?.home]);
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
        {site && <Hint>📖 {site.name}</Hint>}
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
          {site && <Btn onClick={() => openWiki({ ...t, view: { kind: "page", url: site.home } })}>Main page</Btn>}
          <Btn onClick={() => desk.ui.showModal(<PickWiki appId={game.appId} gameName={game.name} current={site ?? undefined} onPicked={setSite} />)}>
            Change wiki
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
    const s = desk.settings.use<WikiSettings>();
    const chosen = Object.entries(s.wikis ?? {});
    const forget = (appId: string) => {
      const wikis = { ...s.wikis };
      delete wikis[appId];
      desk.settings.set<WikiSettings>({ wikis });
    };
    const { Line, Hint } = desk.bits;
    const name = (appId: string) =>
      (window as any).appStore?.GetAppOverviewByAppID?.(Number(appId))?.display_name ?? (appId ? `App ${appId}` : "No game");
    return (
      <ModalRoot className="dom-modal" onCancel={closeModal} closeModal={closeModal}>
        <h2 style={{ marginTop: 0 }}>📖 Wiki</h2>
        <Hint>The wiki picked for each game. Press A to forget one; Desk looks for a wiki again next time.</Hint>
        <div style={{ maxHeight: "45vh", overflowY: "auto", margin: "8px 0" }}>
          {!chosen.length && <Hint>None yet.</Hint>}
          {chosen.map(([appId, w]) => (
            <Line key={appId} icon="📖" onOpen={() => forget(appId)} okLabel="Forget">
              <div>{name(appId)}</div>
              <div style={{ fontSize: "12px", opacity: 0.6 }}>{w.name}</div>
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
