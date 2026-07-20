import { Allotment, LayoutPriority } from "allotment";
import { useCallback, useEffect, useState } from "react";
import "allotment/dist/style.css";
import { RepoSelector } from "../shared/components/RepoSelector";
import { Tooltip } from "../shared/components/Tooltip";
import "../shared/components/Tooltip.css";
import { usePreventSelect } from "../shared/hooks/usePreventSelect";
import { usePanelStore } from "../shared/store/panel-store";
import { t } from "../shared/i18n";
import { bridge } from "../shared/bridge";
import { BranchTree } from "./components/BranchTree";
import { DetailPanel } from "./components/DetailPanel";
import { ErrorBanner } from "./components/ErrorBanner";
import { GitGraphPanel } from "./components/GitGraphPanel";
import { Toolbar } from "./components/Toolbar";
import "./panel.css";

// ── Panel layout persistence ────────────────────────────────────────
// The Git Log panel's layout (sidebar visibility + pane widths) is persisted
// via the webview's vscode.getState/setState, which VSCode serializes and
// restores automatically when the panel is reopened or VSCode restarts.
// Everything here is best-effort: a read/write failure is swallowed so a
// corrupted state never breaks the UI (it just falls back to defaults).
interface PanelLayout {
  /** Left branch sidebar visible. */
  showLeft: boolean;
  /** Right detail pane visible. */
  showRight: boolean;
  /** Left branch sidebar pixel width (when shown). */
  leftWidth: number;
  /** Middle history-list pane pixel width (from Allotment sash position). */
  middleWidth: number;
  /** Right detail pane pixel width (from Allotment sash position). */
  rightWidth: number;
}

const LAYOUT_DEFAULTS: PanelLayout = {
  showLeft: true,
  showRight: true,
  leftWidth: 330,
  middleWidth: 0,
  rightWidth: 350,
};
const LAYOUT_KEY = "panelLayout";

function loadPanelLayout(): PanelLayout {
  try {
    const root = (bridge.getState() ?? {}) as Record<string, unknown>;
    return {
      ...LAYOUT_DEFAULTS,
      ...(root[LAYOUT_KEY] as Partial<PanelLayout>),
    };
  } catch {
    return { ...LAYOUT_DEFAULTS };
  }
}

function savePanelLayout(partial: Partial<PanelLayout>): void {
  try {
    const root = (bridge.getState() ?? {}) as Record<string, unknown>;
    const merged = {
      ...LAYOUT_DEFAULTS,
      ...(root[LAYOUT_KEY] as Partial<PanelLayout>),
      ...partial,
    };
    bridge.setState({ ...root, [LAYOUT_KEY]: merged });
  } catch {
    // best-effort: never let persistence break the UI
  }
}

function ProgressBar({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        height: 3,
        zIndex: 10000,
        overflow: "hidden",
        background: "rgba(0, 122, 204, 0.15)",
      }}
    >
      <div
        style={{
          height: "100%",
          width: "40%",
          background:
            "linear-gradient(90deg, transparent, var(--vscode-progressBar-background, #007acc) 30%, var(--vscode-progressBar-background, #3794ff) 70%, transparent)",
          animation: "progress-slide 1s infinite linear",
        }}
      />
      <style>
        {`@keyframes progress-slide {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(250%); }
        }`}
      </style>
    </div>
  );
}

export function PanelApp() {
  const loading = usePanelStore((s) => s.loading);
  const commits = usePanelStore((s) => s.commits);
  const operationInProgress = usePanelStore((s) => s.operationInProgress);

  const [initialLayout] = useState(loadPanelLayout);
  const [showLeft, setShowLeft] = useState(initialLayout.showLeft);
  const [showRight, setShowRight] = useState(initialLayout.showRight);
  const [leftWidth, setLeftWidth] = useState(initialLayout.leftWidth);

  const toggleLeft = useCallback(() => setShowLeft((v) => !v), []);
  const toggleRight = useCallback(() => setShowRight((v) => !v), []);

  // Persist visibility so the layout survives panel reopen / VSCode restart.
  // (Mount writes the loaded value back — harmless, it's an idempotent merge.)
  useEffect(() => {
    savePanelLayout({ showLeft });
  }, [showLeft]);
  useEffect(() => {
    savePanelLayout({ showRight });
  }, [showRight]);

  // Drag handle for left panel resize
  const startLeftResize = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = leftWidth;
      let lastWidth = leftWidth;
      const onMove = (ev: MouseEvent) => {
        const newWidth = Math.max(
          140,
          Math.min(500, startWidth + ev.clientX - startX),
        );
        lastWidth = newWidth;
        setLeftWidth(newWidth);
      };
      const onUp = () => {
        savePanelLayout({ leftWidth: lastWidth });
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [leftWidth],
  );

  const middleRef = usePreventSelect();

  // Ready handshake: query the host for the current repo + repo list, then
  // fetch. Replaces the previous unconditional fetchInitialData() call — we
  // can no longer assume a default repo now that multiple repos are possible
  // (a repoless fetch would hit NOT_GIT_REPO or the wrong repo).
  useEffect(() => {
    void usePanelStore.getState().initRepo();
  }, []);

  if (loading && commits.length === 0) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          opacity: 0.5,
        }}
      >
        {t("Loading...")}
      </div>
    );
  }

  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        position: "relative",
        background: "var(--vscode-sideBar-background)",
      }}
    >
      <ProgressBar visible={operationInProgress || loading} />
      <ErrorBanner />
      <RepoSelector store="panel" />
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        {/* Left branch panel — outside Allotment to avoid flicker */}
        <div
          style={{
            width: showLeft ? leftWidth : 28,
            height: "100%",
            flexShrink: 0,
            overflow: "hidden",
            display: "flex",
          }}
        >
          {showLeft ? (
            <div
              style={{
                flex: 1,
                height: "100%",
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
              }}
            >
              <BranchTree onTogglePanel={toggleLeft} />
            </div>
          ) : (
            <div
              style={{
                height: "100%",
                width: "100%",
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "center",
                paddingTop: 4,
              }}
            >
              <Tooltip text={t("Show Branches")}>
                <button
                  type="button"
                  className="panel-toggle-btn"
                  onClick={toggleLeft}
                >
                  <ChevronRightIcon />
                </button>
              </Tooltip>
            </div>
          )}
          {showLeft && (
            <div
              onMouseDown={startLeftResize}
              style={{
                width: 4,
                cursor: "col-resize",
                flexShrink: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <div
                style={{
                  width: 1,
                  height: "100%",
                  background: "var(--border)",
                }}
              />
            </div>
          )}
          {!showLeft && (
            <div
              style={{
                width: 1,
                flexShrink: 0,
                background: "var(--border)",
              }}
            />
          )}
        </div>

        {/* Middle + Right in Allotment */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <Allotment
            proportionalLayout={false}
            defaultSizes={
              initialLayout.middleWidth > 0 && initialLayout.rightWidth > 0
                ? [initialLayout.middleWidth, initialLayout.rightWidth]
                : undefined
            }
            onDragEnd={(sizes) => {
              if (sizes.length >= 2) {
                savePanelLayout({
                  middleWidth: sizes[0],
                  rightWidth: sizes[1],
                });
              }
            }}
          >
            <Allotment.Pane minSize={400} priority={LayoutPriority.High}>
              <div
                ref={middleRef}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  height: "100%",
                }}
              >
                <Toolbar />
                <GitGraphPanel />
              </div>
            </Allotment.Pane>
            <Allotment.Pane
              preferredSize={350}
              minSize={showRight ? 250 : 28}
              maxSize={showRight ? 600 : 28}
              visible
            >
              {showRight ? (
                <div
                  style={{
                    height: "100%",
                    display: "flex",
                    flexDirection: "column",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "flex-end",
                      padding: "4px 4px 0",
                      flexShrink: 0,
                    }}
                  >
                    <Tooltip text={t("Hide Details")}>
                      <button
                        type="button"
                        className="panel-toggle-btn"
                        onClick={toggleRight}
                      >
                        <ChevronRightIcon />
                      </button>
                    </Tooltip>
                  </div>
                  <div style={{ flex: 1, overflow: "hidden" }}>
                    <DetailPanel />
                  </div>
                </div>
              ) : (
                <div
                  style={{
                    height: "100%",
                    display: "flex",
                    alignItems: "flex-start",
                    justifyContent: "center",
                    paddingTop: 4,
                    borderLeft: "1px solid var(--border)",
                  }}
                >
                  <Tooltip text={t("Show Details")}>
                    <button
                      type="button"
                      className="panel-toggle-btn"
                      onClick={toggleRight}
                    >
                      <ChevronLeftIcon />
                    </button>
                  </Tooltip>
                </div>
              )}
            </Allotment.Pane>
          </Allotment>
        </div>
      </div>
    </div>
  );
}

function ChevronRightIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path
        d="M6 4.5L9.5 8L6 11.5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChevronLeftIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path
        d="M10 4.5L6.5 8L10 11.5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
