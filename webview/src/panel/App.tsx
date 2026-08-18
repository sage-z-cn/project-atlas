import { Allotment, LayoutPriority, type AllotmentHandle } from "allotment";
import { useCallback, useEffect, useRef, useState } from "react";
import "allotment/dist/style.css";
import { EmptyRepoState } from "../shared/components/EmptyRepoState";
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
import IconLayoutPanel from "~icons/codicon/layout-panel";
import IconLayoutPanelRight from "~icons/codicon/layout-panel-right";
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
  /** Bottom detail pane pixel height, used when detailPanelPosition is "bottom". */
  bottomHeight: number;
}

const LAYOUT_DEFAULTS: PanelLayout = {
  showLeft: true,
  showRight: true,
  leftWidth: 330,
  middleWidth: 0,
  rightWidth: 350,
  bottomHeight: 260,
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
  const repos = usePanelStore((s) => s.repos);
  const repoInitialized = usePanelStore((s) => s.repoInitialized);
  const detailPanelPosition = usePanelStore((s) => s.detailPanelPosition);
  const setDetailPanelPosition = usePanelStore(
    (s) => s.setDetailPanelPosition,
  );

  const [initialLayout] = useState(loadPanelLayout);
  const [showLeft, setShowLeft] = useState(initialLayout.showLeft);
  const [showRight, setShowRight] = useState(initialLayout.showRight);
  const [leftWidth, setLeftWidth] = useState(initialLayout.leftWidth);
  // Bottom detail pane height (persisted). Kept as live state (not just the
  // one-shot initialLayout) so re-expanding after a collapse can restore it
  // via the imperative Allotment resize below.
  const [bottomHeight, setBottomHeight] = useState(initialLayout.bottomHeight);
  // Right-mode pane widths (persisted). Also live state: position toggles
  // unmount/remount this Allotment, and a stale one-shot initialLayout would
  // reset the sash to the session-start widths on every right → bottom →
  // right round trip, discarding this session's drags.
  const [rightPaneSizes, setRightPaneSizes] = useState(
    initialLayout.middleWidth > 0 && initialLayout.rightWidth > 0
      ? { middle: initialLayout.middleWidth, right: initialLayout.rightWidth }
      : null,
  );
  // Measured height of the bottom-mode Allotment container (0 = not yet
  // measured). Drives the adaptive pane minimums below.
  const [bottomContainerHeight, setBottomContainerHeight] = useState(0);

  const toggleLeft = useCallback(() => setShowLeft((v) => !v), []);
  const toggleRight = useCallback(() => setShowRight((v) => !v), []);
  const toggleDetailPanelPosition = useCallback(() => {
    setDetailPanelPosition(
      detailPanelPosition === "right" ? "bottom" : "right",
    );
  }, [detailPanelPosition, setDetailPanelPosition]);

  const bottomWrapRef = useRef<HTMLDivElement>(null);
  const bottomAllotmentRef = useRef<AllotmentHandle>(null);

  // Track the bottom-mode Allotment container height so the pane minimums can
  // adapt when the VSCode bottom panel is dragged very small: with fixed
  // minimums (graph 200 + detail 150) a short container overflows and the
  // detail pane — laid out last — gets pushed entirely out of view.
  //
  // Attached via a callback ref, NOT a position-keyed effect: the loading
  // early-return keeps the bottom layout unmounted at mount time, so when the
  // position is already "bottom" (persisted config, window reload) the effect
  // runs while the ref is still null and skips — the observer would then never
  // attach for the whole session and auto-collapse would never fire. A
  // callback ref ties the observer to the element's actual presence instead.
  const attachBottomWrap = useCallback((el: HTMLDivElement | null) => {
    bottomWrapRef.current = el;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setBottomContainerHeight(entry.contentRect.height);
      }
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      bottomWrapRef.current = null;
    };
  }, []);

  // Adaptive minimums + forced collapse for the bottom split. An expanded
  // bottom layout needs at least graph floor + detail minimum; below that the
  // detail pane is force-collapsed (and expansion disabled) instead of being
  // squeezed out of view. `showRight` stays the user's persisted preference —
  // `detailExpanded` is the effective state, so recovering space restores it.
  const GRAPH_FLOOR = 40;
  const DETAIL_MIN = 150;
  const tooSmall =
    detailPanelPosition === "bottom" &&
    bottomContainerHeight > 0 &&
    bottomContainerHeight < GRAPH_FLOOR + DETAIL_MIN;
  const detailExpanded = showRight && !tooSmall;
  const graphMin = Math.max(
    GRAPH_FLOOR,
    Math.min(200, bottomContainerHeight - (detailExpanded ? DETAIL_MIN : 28)),
  );
  const detailMin = detailExpanded ? DETAIL_MIN : 28;

  // Restore the remembered height when the bottom detail pane re-expands.
  // Allotment keeps its internal sizing across the min/max change that the
  // collapse toggle causes, so expanding after a collapse would otherwise
  // land on the pane minimum. The imperative resize re-applies the persisted
  // bottomHeight; this effect runs AFTER Allotment's internal effects have
  // applied the new min/max for this render, so the value isn't clamped to
  // the collapsed 28px constraint.
  //
  // Guarded to the collapse → expand transition ONLY: on a fresh mount
  // (position just switched to "bottom") Allotment's internal SplitView views
  // are not ready yet — calling resize() there crashes — and the pane's
  // preferredSize already applies the remembered height on mount anyway.
  const prevDetailLayoutRef = useRef({
    position: detailPanelPosition,
    expanded: detailExpanded,
  });
  useEffect(() => {
    const prev = prevDetailLayoutRef.current;
    prevDetailLayoutRef.current = {
      position: detailPanelPosition,
      expanded: detailExpanded,
    };
    // Only the collapse → expand transition needs the imperative restore.
    // (Covers both manual expand and the tooSmall force-collapse ending when
    // the panel regains enough height — showRight never changed in that case,
    // so Allotment's internal sizing is still stuck at the collapsed 28px.)
    if (detailPanelPosition !== "bottom" || !detailExpanded) return;
    if (prev.position !== "bottom" || prev.expanded) return;
    const total = bottomWrapRef.current?.clientHeight ?? 0;
    if (total <= 0) return;
    const h = Math.min(
      Math.max(bottomHeight > 0 ? bottomHeight : 260, 150),
      600,
    );
    bottomAllotmentRef.current?.resize([Math.max(total - h, 0), h]);
  }, [detailExpanded, detailPanelPosition, bottomHeight]);

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
    void usePanelStore.getState().fetchDetailPanelPosition();
  }, []);

  // Empty state: the ready handshake confirmed a repoless workspace. Checked
  // BEFORE the loading guard so that once we know there's no repo, we never
  // flash "Loading..." (the handshake already settled the question). The
  // `repoInitialized` gate prevents a startup flash of this card while the
  // handshake is still in flight.
  if (repoInitialized && repos.length === 0) {
    return <EmptyRepoState />;
  }

  // Loading state: handshake not yet complete, or initial graph fetch in
  // flight with nothing to show yet. Also covers the pre-handshake mount so
  // the panel doesn't briefly render an empty shell.
  if (!repoInitialized || (loading && commits.length === 0)) {
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

        {/* Middle + Right (or Middle + Bottom) in Allotment */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {detailPanelPosition === "bottom" ? (
            <div
              ref={middleRef}
              style={{
                display: "flex",
                flexDirection: "column",
                height: "100%",
              }}
            >
              <Toolbar />
              <div ref={attachBottomWrap} style={{ flex: 1, minHeight: 0 }}>
                <Allotment
                  ref={bottomAllotmentRef}
                  vertical
                  proportionalLayout={false}
                  onDragEnd={(sizes) => {
                    // Guard: while collapsed (min=max=28) a stray drag would
                    // persist 28 and clobber the remembered height.
                    if (!detailExpanded || sizes.length < 2) return;
                    setBottomHeight(sizes[1]);
                    savePanelLayout({ bottomHeight: sizes[1] });
                  }}
                >
                  <Allotment.Pane minSize={graphMin} priority={LayoutPriority.High}>
                    <GitGraphPanel />
                  </Allotment.Pane>
                  <Allotment.Pane
                    preferredSize={
                      bottomHeight > 0 ? bottomHeight : 260
                    }
                    minSize={detailMin}
                    maxSize={detailExpanded ? 600 : 28}
                  >
                    {detailExpanded ? (
                      <div
                        style={{
                          height: "100%",
                          display: "flex",
                          flexDirection: "column",
                          position: "relative",
                        }}
                      >
                        {/* Floating action buttons — overlay the detail
                            content's top-right instead of taking their own
                            header row (saves vertical space). */}
                        <div
                          style={{
                            position: "absolute",
                            top: 4,
                            right: 4,
                            zIndex: 10,
                            display: "flex",
                            gap: 2,
                          }}
                        >
                          <Tooltip text={t("Move to Right")}>
                            <button
                              type="button"
                              className="panel-toggle-btn"
                              onClick={toggleDetailPanelPosition}
                            >
                              <IconLayoutPanelRight width={16} height={16} />
                            </button>
                          </Tooltip>
                          <Tooltip text={t("Hide Details")}>
                            <button
                              type="button"
                              className="panel-toggle-btn"
                              onClick={toggleRight}
                            >
                              <ChevronDownIcon />
                            </button>
                          </Tooltip>
                        </div>
                        <div style={{ flex: 1, overflow: "hidden" }}>
                          <DetailPanel orientation="horizontal" />
                        </div>
                      </div>
                    ) : (
                      <div
                        style={{
                          height: "100%",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "flex-end",
                          gap: 2,
                          padding: "0 4px",
                          borderTop: "1px solid var(--border)",
                        }}
                      >
                        <Tooltip text={t("Move to Right")}>
                          <button
                            type="button"
                            className="panel-toggle-btn"
                            onClick={toggleDetailPanelPosition}
                          >
                            <IconLayoutPanelRight width={16} height={16} />
                          </button>
                        </Tooltip>
                        <Tooltip text={t("Show Details")}>
                          <button
                            type="button"
                            className="panel-toggle-btn"
                            onClick={toggleRight}
                            disabled={tooSmall}
                          >
                            <ChevronUpIcon />
                          </button>
                        </Tooltip>
                      </div>
                    )}
                  </Allotment.Pane>
                </Allotment>
              </div>
            </div>
          ) : (
            <Allotment
              proportionalLayout={false}
              defaultSizes={
                rightPaneSizes
                  ? [rightPaneSizes.middle, rightPaneSizes.right]
                  : undefined
              }
              onDragEnd={(sizes) => {
                if (!showRight || sizes.length < 2) return;
                setRightPaneSizes({ middle: sizes[0], right: sizes[1] });
                savePanelLayout({
                  middleWidth: sizes[0],
                  rightWidth: sizes[1],
                });
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
                        gap: 2,
                        padding: "4px 4px 0",
                        flexShrink: 0,
                      }}
                    >
                      <Tooltip text={t("Move to Bottom")}>
                        <button
                          type="button"
                          className="panel-toggle-btn"
                          onClick={toggleDetailPanelPosition}
                        >
                          <IconLayoutPanel width={16} height={16} />
                        </button>
                      </Tooltip>
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
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 2,
                      paddingTop: 4,
                      borderLeft: "1px solid var(--border)",
                    }}
                  >
                    <Tooltip text={t("Move to Bottom")}>
                      <button
                        type="button"
                        className="panel-toggle-btn"
                        onClick={toggleDetailPanelPosition}
                      >
                        <IconLayoutPanel width={16} height={16} />
                      </button>
                    </Tooltip>
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
          )}
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

function ChevronDownIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path
        d="M4.5 6L8 9.5L11.5 6"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChevronUpIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path
        d="M4.5 10L8 6.5L11.5 10"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
