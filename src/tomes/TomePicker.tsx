import { FC } from "react";
import { DialogButton, Focusable, ToggleField } from "@decky/ui";
import { CATEGORIES } from "./registry";
import { DeskAt, setTomeOn, useArrangement } from "./layout";
import { GAME_PAGE } from "./pages";
import * as s from "../components/styles";

/**
 * Add or remove Tomes: every Tome with a switch, grouped by category. Drawn in place (on the Desk and in
 * Settings → Desk) rather than in a window, so it works the same from the Quick Access menu.
 */
export const TomeList: FC<{ at?: DeskAt; pageName?: string; gameName?: string; onDone?: () => void }> = ({
  at = { pageId: GAME_PAGE, appId: null },
  pageName,
  gameName,
  onDone,
}) => {
  const { items, perGame } = useArrangement(at);
  const appId = at.appId;
  const done = onDone && (
    <Focusable style={{ ...s.toolbar, flexWrap: "nowrap" }}>
      <DialogButton style={s.primaryButton} onClick={onDone}>
        Done
      </DialogButton>
      <div style={{ fontSize: "13px", opacity: 0.8, flex: 1, minWidth: 0 }}>
        {pageName ? `For the ${pageName} page` : appId && perGame && gameName ? `For ${gameName}'s Desk` : "For every game's Desk"}
      </div>
    </Focusable>
  );
  return (
    <div>
      {done}
      {CATEGORIES.map((c) => {
        const shown = items.filter((x) => x.def.category === c.id);
        if (!shown.length) return null;
        return (
          <div key={c.id}>
            <div style={s.sectionLabel}>
              {c.icon} {c.label}
            </div>
            {shown.map(({ def, on }) => (
              <ToggleField
                key={def.id}
                label={
                  <span>
                    {def.icon} {def.name}
                  </span>
                }
                description={def.scroll ? `${def.description} (from the ${def.scroll} Scroll)` : def.description}
                checked={on}
                onChange={(v) => setTomeOn(at, def.id, v)}
              />
            ))}
          </div>
        );
      })}
      {done && <div style={{ marginTop: "10px" }}>{done}</div>}
    </div>
  );
};
