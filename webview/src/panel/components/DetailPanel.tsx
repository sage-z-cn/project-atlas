import { Allotment } from "allotment";
import { CommitDetail } from "./CommitDetail";
import { FileChangeTree } from "./FileChangeTree";

/**
 * @param orientation Split direction of the two detail sections.
 *   "vertical" (default): file tree above commit detail — used when the
 *   panel is docked to the right (narrow and tall).
 *   "horizontal": file tree left, commit detail right — used when the
 *   panel is docked to the bottom (wide and short).
 */
export function DetailPanel({
  orientation = "vertical",
}: {
  orientation?: "vertical" | "horizontal";
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
      }}
    >
      <Allotment vertical={orientation === "vertical"}>
        <Allotment.Pane minSize={60} preferredSize="40%">
          <div style={{ height: "100%", overflow: "hidden" }}>
            <FileChangeTree />
          </div>
        </Allotment.Pane>
        <Allotment.Pane minSize={60}>
          <div style={{ height: "100%", overflow: "auto" }}>
            <CommitDetail
              headerReserveRight={orientation === "horizontal" ? 46 : 0}
            />
          </div>
        </Allotment.Pane>
      </Allotment>
    </div>
  );
}
