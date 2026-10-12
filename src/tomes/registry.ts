import { FC, useSyncExternalStore } from "react";
import { Game, TomeSize } from "../types";

// Tomes are the Desk's widgets: small views and actions over the same notes, counters and checklists the
// notes list uses (never copies of them). Built-in Tomes register below; Scrolls will register theirs the
// same way.

export type TomeCategory = "desk" | "gaming" | "play" | "trophies" | "workshop" | "deck";

export const CATEGORIES: { id: TomeCategory; label: string; icon: string }[] = [
  { id: "desk", label: "My Desk", icon: "🗂️" },
  { id: "gaming", label: "Gaming", icon: "🎮" },
  { id: "play", label: "Play time", icon: "⏱️" },
  { id: "trophies", label: "Achievements", icon: "🏆" },
  { id: "workshop", label: "Workshop", icon: "🏭" },
  { id: "deck", label: "Deck", icon: "🖥️" },
];

export interface TomeProps {
  /** The Desk's game, loaded; null while loading or when there's no game to show. */
  game: Game | null;
  /** The game is running right now. */
  live: boolean;
  /** Full-screen page (more room) rather than the Quick Access menu. */
  fullScreen: boolean;
  /** Opens the game's full notes list on the Desk (optionally in a folder). */
  showNotes: (folderId?: string | null) => void;
  /** How it's drawn: a small tile (a big number) or a full-width card. */
  size: TomeSize;
  /** Switches to another tab (e.g. the Workshop). */
  goTab: (tab: "all" | "workshop" | "settings") => void;
}

export interface TomeDef {
  id: string;
  name: string;
  icon: string;
  category: TomeCategory;
  /** One line for the picker. */
  description: string;
  /** On the Desk for new users. */
  defaultOn: boolean;
  /** Only makes sense with a game picked; otherwise the Tome shows a hint instead. */
  needsGame: boolean;
  /** Has nothing to show for this game (hidden outside edit mode, so empty Tomes don't take room). */
  isEmpty?: (game: Game | null) => boolean;
  component: FC<TomeProps>;
  /** The sizes it can be drawn at, the first being its default unless `defaultSize` says; unset = card only. */
  sizes?: TomeSize[];
  defaultSize?: TomeSize;
  /** What A does on its tile (e.g. open the full achievements page); unset = nothing. */
  onTileOpen?: (props: TomeProps) => void;
  /** Added by a Scroll rather than built in. */
  scroll?: string;
}

const tomes: TomeDef[] = [];
const listeners = new Set<() => void>();
let snapshot: readonly TomeDef[] = [];

/** Adds a Tome (built-in or from a Scroll). Registering an id again replaces it. */
export function registerTome(def: TomeDef): () => void {
  const i = tomes.findIndex((t) => t.id === def.id);
  if (i >= 0) tomes[i] = def;
  else tomes.push(def);
  snapshot = [...tomes];
  listeners.forEach((l) => l());
  return () => {
    const j = tomes.indexOf(def);
    if (j >= 0) tomes.splice(j, 1);
    snapshot = [...tomes];
    listeners.forEach((l) => l());
  };
}

export const allTomes = (): readonly TomeDef[] => snapshot;
export const tomeById = (id: string) => snapshot.find((t) => t.id === id);

export function useTomes(): readonly TomeDef[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => snapshot
  );
}
