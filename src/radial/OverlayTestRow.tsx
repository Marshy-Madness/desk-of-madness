import { FC } from "react";
import { ButtonItem } from "@decky/ui";
import { runOverlayTest, useOverlayTest } from "./overlayTest";

/** Settings → Controls: the over-the-game radial test and its last report. */
export const OverlayTestRow: FC = () => {
  const { running, report } = useOverlayTest();
  return (
    <>
      <ButtonItem
        layout="below"
        label="Test: radial menu over the game"
        description="Start a game first. This goes back to it and draws a ring on top for 10 seconds. Note which label it shows, and whether the game moves with the right stick."
        disabled={running}
        onClick={() => runOverlayTest()}
      >
        {running ? "Testing…" : "Run test"}
      </ButtonItem>
      {report.length > 0 && (
        <div style={{ fontFamily: "monospace", fontSize: "12px", whiteSpace: "pre-wrap", opacity: 0.85, padding: "6px 0" }}>
          {report.join("\n")}
        </div>
      )}
    </>
  );
};
