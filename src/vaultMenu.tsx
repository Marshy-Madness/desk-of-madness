import { Menu, MenuItem, showContextMenu, showModal } from "@decky/ui";
import { toaster } from "@decky/api";
import { backend } from "./api/backend";
import { getSettings, updateSettings } from "./state/notesStore";
import { NameModal } from "./components/NameModal";
import { notesLink, openMadnessNotes } from "./madnessNotes";
import { VaultNoteModal } from "./components/VaultNoteModal";
import { NotesRelated, VaultResult } from "./types";

const say = (body: string) => toaster.toast({ title: "Madness Notes", body });

async function openLink(link: string) {
  const err = await openMadnessNotes(link);
  if (err) say(err);
}

async function run<T>(p: Promise<VaultResult<T>>): Promise<T | null> {
  const r = await p;
  if (!r.ok) {
    say(r.error);
    return null;
  }
  return r.data;
}

function quickAdd(appId: string, game: string) {
  showModal(
    <NameModal
      heading={`Quick note for ${game}`}
      label="Note"
      onSubmit={async (text) => {
        if (await run(backend.notesCapture(appId, game, text))) say("Added to Deck Inbox.");
      }}
    />,
  );
}

async function openGameNote(appId: string, game: string) {
  const r = await run(backend.notesGameNote(appId, game, true));
  if (r) await openLink(notesLink({ path: r.path }));
}

async function openNote(appId: string, path: string) {
  const s = getSettings();
  await updateSettings({ notesLastOpened: { ...(s.notesLastOpened ?? {}), [appId]: path } });
  await openLink(notesLink({ path }));
}

/** The game's Madness Notes menu: its vault note, related notes, quick capture and the app itself. */
export async function openVaultMenu(appId: string, game: string) {
  const s = getSettings();
  const connected = !!(s.notesToken && s.notesVaultId);
  const last = s.notesLastOpened?.[appId];
  let related: NotesRelated[] = [];
  if (connected) {
    const r = await backend.notesRelated(appId, game);
    if (r.ok) related = r.data;
  }
  showContextMenu(
    <Menu label="Madness Notes">
      {connected ? (
        <>
          <MenuItem onSelected={() => quickAdd(appId, game)}>Quick note to Deck Inbox…</MenuItem>
          <MenuItem onSelected={() => showModal(<VaultNoteModal appId={appId} gameName={game} />)}>View this game's note</MenuItem>
          <MenuItem onSelected={() => openGameNote(appId, game)}>Open this game's note in the app</MenuItem>
          {last && (
            <MenuItem onSelected={() => openNote(appId, last)}>Continue: {last.split("/").pop()?.replace(/\.md$/, "")}</MenuItem>
          )}
          {related.map((n) => (
            <MenuItem key={n.path} onSelected={() => openNote(appId, n.path)}>
              {n.title}
            </MenuItem>
          ))}
        </>
      ) : (
        <MenuItem disabled>Add an API token in settings for quick notes</MenuItem>
      )}
      <MenuItem onSelected={() => openLink(notesLink({ search: game }))}>Search the app for this game</MenuItem>
      <MenuItem onSelected={() => openLink("")}>Open Madness Notes</MenuItem>
    </Menu>,
  );
}
