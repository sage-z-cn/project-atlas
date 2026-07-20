import { useCallback, useEffect, useMemo, useState } from "react";
import { bridge } from "../shared/bridge";
import {
  buildFileTree,
  collectVisibleFilePaths,
  FileTree,
  STATUS_COLORS,
} from "../shared/components/FileTree";
import {
  type SelectionMode,
  useModifierClickSelection,
} from "../shared/hooks/useModifierClickSelection";
import { usePreventSelect } from "../shared/hooks/usePreventSelect";
import { t } from "../shared/i18n";
import { useMergeStore } from "../shared/store/merge-store";
import type { DiffFile } from "../shared/types/git";
import { ErrorBanner } from "./components/ErrorBanner";

interface MergeState {
  isMerging: boolean;
  mergeHead?: string;
  mergeMsg?: string;
}

function parseMergeMsg(msg: string): { from: string; into: string } | null {
  const match = msg.match(/Merge branch '([^']+)' into (.+)/);
  if (match) {
    return { from: match[1], into: match[2] };
  }
  return null;
}

export function ConflictsApp() {
  const [mergeState, setMergeState] = useState<MergeState | null>(null);
  const [conflictFiles, setConflictFiles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [groupByDir, setGroupByDir] = useState(true);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [lastSelectedFile, setLastSelectedFile] = useState<string | null>(null);

  const setConflictError = useMergeStore((s) => s.setConflictError);

  const containerRef = usePreventSelect<HTMLDivElement>();

  // 卸载时清掉 stale 错误，避免下次打开 webview 时残留上次错误 banner
  useEffect(() => {
    return () => setConflictError(null);
  }, [setConflictError]);

  const loadData = useCallback(async () => {
    setConflictError(null);
    try {
      const [state, files] = await Promise.all([
        bridge.request("getMergeState") as Promise<MergeState>,
        bridge.request("getConflictFiles") as Promise<string[]>,
      ]);
      setMergeState(state);
      setConflictFiles(files);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setConflictError(msg || t("Failed to load conflicts."));
    } finally {
      setLoading(false);
    }
  }, [setConflictError]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Convert string[] to DiffFile[]
  const diffFiles: DiffFile[] = useMemo(
    () =>
      conflictFiles.map((f) => ({
        oldPath: f,
        newPath: f,
        status: "modified" as const,
        isBinary: false,
      })),
    [conflictFiles],
  );

  const viewMode = groupByDir ? "tree" : "flat";

  // Compute flat visible file paths for range selection
  const tree = useMemo(() => buildFileTree(diffFiles), [diffFiles]);
  const flatVisibleFiles = useMemo(
    () =>
      viewMode === "tree"
        ? collectVisibleFilePaths(tree, collapsed)
        : [...conflictFiles].sort((a, b) => {
            const nameA = a.split("/").pop() ?? "";
            const nameB = b.split("/").pop() ?? "";
            return nameA.localeCompare(nameB, undefined, {
              sensitivity: "base",
            });
          }),
    [viewMode, tree, collapsed, conflictFiles],
  );

  const handleSelect = useCallback(
    (file: DiffFile, mode: SelectionMode) => {
      const filePath = file.newPath || file.oldPath;

      if (mode === "single") {
        setSelectedFiles([filePath]);
      } else if (mode === "toggle") {
        setSelectedFiles((prev) =>
          prev.includes(filePath)
            ? prev.filter((f) => f !== filePath)
            : [...prev, filePath],
        );
      } else if (mode === "range") {
        if (!lastSelectedFile) {
          setSelectedFiles([filePath]);
        } else {
          const startIdx = flatVisibleFiles.indexOf(lastSelectedFile);
          const endIdx = flatVisibleFiles.indexOf(filePath);
          if (startIdx === -1 || endIdx === -1) {
            setSelectedFiles([filePath]);
          } else {
            const lo = Math.min(startIdx, endIdx);
            const hi = Math.max(startIdx, endIdx);
            setSelectedFiles(flatVisibleFiles.slice(lo, hi + 1));
          }
        }
      }

      setLastSelectedFile(filePath);
    },
    [lastSelectedFile, flatVisibleFiles],
  );

  const handleFileClick = useModifierClickSelection<DiffFile>(handleSelect);

  const toggleCollapse = (key: string) => {
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  // Batch actions
  const handleAcceptYours = useCallback(async () => {
    if (selectedFiles.length === 0) return;
    setConflictError(null);
    const results = await Promise.allSettled(
      selectedFiles.map((filePath) =>
        bridge.request("acceptOurs", { filePath }),
      ),
    );
    const succeeded: string[] = [];
    const failures: { filePath: string; reason: unknown }[] = [];
    results.forEach((r, i) => {
      const filePath = selectedFiles[i];
      if (r.status === "fulfilled") {
        succeeded.push(filePath);
      } else {
        failures.push({ filePath, reason: r.reason });
      }
    });
    if (succeeded.length > 0) {
      setConflictFiles((prev) => prev.filter((f) => !succeeded.includes(f)));
    }
    if (failures.length > 0) {
      const firstReason = failures[0].reason;
      const detail =
        firstReason instanceof Error ? firstReason.message : String(firstReason);
      setConflictError(
        t(
          "Accept Yours failed for {0} file(s): {1}",
          String(failures.length),
          detail,
        ),
      );
    }
    setSelectedFiles([]);
  }, [selectedFiles, setConflictError]);

  const handleAcceptTheirs = useCallback(async () => {
    if (selectedFiles.length === 0) return;
    setConflictError(null);
    const results = await Promise.allSettled(
      selectedFiles.map((filePath) =>
        bridge.request("acceptTheirs", { filePath }),
      ),
    );
    const succeeded: string[] = [];
    const failures: { filePath: string; reason: unknown }[] = [];
    results.forEach((r, i) => {
      const filePath = selectedFiles[i];
      if (r.status === "fulfilled") {
        succeeded.push(filePath);
      } else {
        failures.push({ filePath, reason: r.reason });
      }
    });
    if (succeeded.length > 0) {
      setConflictFiles((prev) => prev.filter((f) => !succeeded.includes(f)));
    }
    if (failures.length > 0) {
      const firstReason = failures[0].reason;
      const detail =
        firstReason instanceof Error ? firstReason.message : String(firstReason);
      setConflictError(
        t(
          "Accept Theirs failed for {0} file(s): {1}",
          String(failures.length),
          detail,
        ),
      );
    }
    setSelectedFiles([]);
  }, [selectedFiles, setConflictError]);

  const openMergeEditor = useCallback(
    async (filePath: string) => {
      try {
        await bridge.request("openMergeEditor", { file: filePath });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setConflictError(
          t("Failed to open merge editor for '{0}': {1}", filePath, msg),
        );
      }
    },
    [setConflictError],
  );

  const handleMerge = useCallback(async () => {
    if (selectedFiles.length > 0) {
      await openMergeEditor(selectedFiles[0]);
    }
  }, [selectedFiles, openMergeEditor]);

  // Extra columns: Yours / Theirs status
  const renderExtraColumns = useCallback(
    (_file: DiffFile) => (
      <>
        <span
          style={{
            marginLeft: "auto",
            fontSize: 11,
            color: STATUS_COLORS.conflicts,
            flexShrink: 0,
            minWidth: 60,
            textAlign: "center",
          }}
        >
          {t("Modified")}
        </span>
        <span
          style={{
            fontSize: 11,
            color: STATUS_COLORS.conflicts,
            flexShrink: 0,
            minWidth: 60,
            textAlign: "center",
          }}
        >
          {t("Modified")}
        </span>
      </>
    ),
    [],
  );

  if (loading) {
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

  const branchInfo = mergeState?.mergeMsg
    ? parseMergeMsg(mergeState.mergeMsg)
    : null;

  const hasSelection = selectedFiles.length > 0;

  return (
    <div
      ref={containerRef}
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        fontFamily: "var(--font-family)",
        userSelect: "none",
      }}
    >
      <ErrorBanner />
      {/* Header */}
      <div style={{ padding: "12px 16px 8px", flexShrink: 0 }}>
        <h2
          style={{
            fontSize: 16,
            fontWeight: 700,
            margin: 0,
            marginBottom: 4,
          }}
          >
          {t("Conflicts")}
        </h2>
        <p style={{ margin: 0, fontSize: 13, opacity: 0.8 }}>
          {branchInfo ? (
            <>
              {t("Merging branch '{0}' into '{1}'", branchInfo.from, branchInfo.into)}
            </>
          ) : mergeState?.isMerging ? (
            <>{t("Merge in progress")}</>
          ) : (
            <>{t("No merge in progress")}</>
          )}
        </p>
        {conflictFiles.length > 0 && (
          <p style={{ margin: 0, marginTop: 4, fontSize: 12, opacity: 0.6 }}>
            {t("{0} file(s) with conflicts", conflictFiles.length)}
          </p>
        )}
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12,
            marginTop: 8,
          }}
        >
          <input
            type="checkbox"
            checked={groupByDir}
            onChange={(e) => setGroupByDir(e.target.checked)}
          />
          {t("Group files by directory")}
        </label>
      </div>

      {/* Main body */}
      {conflictFiles.length === 0 ? (
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            opacity: 0.5,
          }}
        >
          {t("All conflicts resolved")}
        </div>
      ) : (
        <div
          style={{
            flex: 1,
            display: "flex",
            minHeight: 0,
            borderTop: "1px solid var(--border)",
          }}
        >
          {/* Left: column headers + file tree */}
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              minWidth: 0,
              overflow: "hidden",
            }}
          >
            {/* Column header */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                padding: "4px 12px",
                fontSize: 12,
                fontWeight: 600,
                opacity: 0.7,
                borderBottom: "1px solid var(--border)",
                flexShrink: 0,
              }}
            >
              <span style={{ flex: 1 }}>{t("Name")}</span>
              <span
                style={{
                  minWidth: 60,
                  textAlign: "center",
                  flexShrink: 0,
                }}
              >
                {t("Yours")}
              </span>
              <span
                style={{
                  minWidth: 60,
                  textAlign: "center",
                  flexShrink: 0,
                }}
              >
                {t("Theirs")}
              </span>
            </div>
            {/* File tree */}
            <div style={{ flex: 1, overflow: "auto" }}>
              <FileTree
                files={diffFiles}
                viewMode={viewMode}
                selectedFiles={selectedFiles}
                onFileClick={handleFileClick}
                onFileDoubleClick={(file) => {
                  const filePath = file.newPath || file.oldPath;
                  void openMergeEditor(filePath);
                }}
                collapsed={collapsed}
                onToggle={toggleCollapse}
                renderExtraColumns={renderExtraColumns}
                statusColorOverride={() => STATUS_COLORS.conflicts}
              />
            </div>
          </div>

          {/* Right: action buttons */}
          <div
            style={{
              width: 130,
              flexShrink: 0,
              display: "flex",
              flexDirection: "column",
              gap: 6,
              padding: "12px 12px",
              borderLeft: "1px solid var(--border)",
            }}
          >
            <ActionButton disabled={!hasSelection} onClick={handleAcceptYours}>
              {t("Accept Yours")}
            </ActionButton>
            <ActionButton disabled={!hasSelection} onClick={handleAcceptTheirs}>
              {t("Accept Theirs")}
            </ActionButton>
            <ActionButton
              disabled={!hasSelection}
              onClick={handleMerge}
              primary
            >
              {t("Merge...")}
            </ActionButton>
          </div>
        </div>
      )}
    </div>
  );
}

function ActionButton({
  onClick,
  children,
  primary,
  disabled,
}: {
  onClick: () => void;
  children: React.ReactNode;
  primary?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "4px 10px",
        fontSize: 12,
        fontFamily: "var(--font-family)",
        border: "1px solid var(--border)",
        background: primary ? "var(--button-bg)" : "transparent",
        color: primary ? "var(--button-fg)" : "var(--app-fg)",
        cursor: disabled ? "default" : "pointer",
        borderRadius: 3,
        lineHeight: "20px",
        whiteSpace: "nowrap",
        opacity: disabled ? 0.4 : 1,
        width: "100%",
      }}
    >
      {children}
    </button>
  );
}
