import { useCallback, useEffect, useMemo, useState } from "react";
import { bridge } from "../shared/bridge";
import { Tooltip } from "../shared/components/Tooltip";
import "../shared/components/Tooltip.css";
import { t } from "../shared/i18n";
import { useMergeStore } from "../shared/store/merge-store";
import { ErrorBanner } from "./components/ErrorBanner";
import { MergeContainer } from "./components/MergeContainer";
import { parseMergeBlocks } from "./utils/merge-logic";

interface FileVersionsPayload {
  base: string;
  ours: string;
  theirs: string;
  language: string;
}

function getMergeFileFromRoot(): string | null {
  const root = document.getElementById("root");
  return root?.dataset.file ?? null;
}

export function MergeStandaloneApp() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const {
    setBlocks,
    blocks,
    isDirty,
    acceptAllLeft,
    acceptAllRight,
    resetToInitial,
    setConflictError,
  } = useMergeStore();

  const filePath = useMemo(() => getMergeFileFromRoot(), []);

  // 卸载时清掉 stale 错误，避免下次打开 merge editor 时残留上次错误 banner
  useEffect(() => {
    return () => setConflictError(null);
  }, [setConflictError]);

  // Conflict navigation state
  const conflictBlockIds = useMemo(
    () => blocks.filter((b) => b.state === "conflict").map((b) => b.id),
    [blocks],
  );
  const changeCount = useMemo(
    () => blocks.filter((b) => b.state !== "equal").length,
    [blocks],
  );
  const conflictCount = conflictBlockIds.length;
  const allResolved = useMemo(
    () => blocks.every((b) => b.state === "equal" || b.isResolved),
    [blocks],
  );

  const [activeConflictIndex, setActiveConflictIndex] = useState(-1);
  const activeBlockId =
    activeConflictIndex >= 0 && activeConflictIndex < conflictBlockIds.length
      ? conflictBlockIds[activeConflictIndex]
      : undefined;

  const goToPrevConflict = useCallback(() => {
    if (conflictCount === 0) return;
    setActiveConflictIndex((prev) =>
      prev <= 0 ? conflictCount - 1 : prev - 1,
    );
  }, [conflictCount]);

  const goToNextConflict = useCallback(() => {
    if (conflictCount === 0) return;
    setActiveConflictIndex((prev) =>
      prev >= conflictCount - 1 ? 0 : prev + 1,
    );
  }, [conflictCount]);

  // Apply: save + stage + open + close. 每步独立 try-catch，让用户清楚部分
  // 成功的状态（save 成功但 stage 失败时不能只说 "Apply failed"）。
  const handleApply = useCallback(async () => {
    if (!filePath) return;
    setConflictError(null);
    const content = blocks.map((b) => b.resultLines.join("\n")).join("\n");

    // Step 1: 保存到磁盘。失败意味着什么都没写盘，直接中止。
    try {
      await bridge.request("saveMergedContent", { filePath, content });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setConflictError(t("Save failed: {0}", msg));
      return;
    }

    // Step 2: stage。save 已成功，stage 失败属于部分成功——保留 merge editor
    // 让用户重试 stage，不丢失已保存的内容。
    try {
      await bridge.request("stageFile", { filePath });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setConflictError(
        t("Content saved to disk, but staging failed: {0}", msg),
      );
      return;
    }

    // Step 3 & 4: 收尾操作（打开文件 + 关闭 merge editor）。主操作 save+stage
    // 已成功，这里把多个错误聚合展示，不中止。
    const tailErrors: string[] = [];
    try {
      await bridge.request("openFile", { filePath });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      tailErrors.push(`${t("open file")}: ${msg}`);
    }
    try {
      await bridge.request("closeMergeEditor", { filePath });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      tailErrors.push(`${t("close merge editor")}: ${msg}`);
    }
    if (tailErrors.length > 0) {
      setConflictError(t("Applied, but: {0}", tailErrors.join("; ")));
    }
  }, [filePath, blocks, setConflictError]);

  // Cancel: confirm if dirty, then close
  const handleCancel = useCallback(async () => {
    if (!filePath) return;
    if (isDirty) {
      const res = (await bridge.request("confirmCancelMerge", {
        filePath,
        hasChanges: true,
      })) as { confirmed: boolean };
      if (!res.confirmed) return;
    }
    resetToInitial();
    await bridge.request("closeMergeEditor", { filePath });
  }, [filePath, isDirty, resetToInitial]);

  useEffect(() => {
    if (!filePath) {
      setLoading(false);
      setError(t("Missing merge file path."));
      return;
    }

    let disposed = false;
    void (async () => {
      try {
        const versions = (await bridge.request("getFileVersions", {
          filePath,
        })) as FileVersionsPayload;
        if (disposed) return;
        const parsed = parseMergeBlocks(
          versions.base,
          versions.theirs,
          versions.ours,
        );
        setBlocks(parsed, versions.language);
      } catch (e) {
        if (!disposed) {
          const message = e instanceof Error ? e.message : String(e);
          setError(message || t("Failed to load merge content."));
        }
      } finally {
        if (!disposed) setLoading(false);
      }
    })();

    return () => {
      disposed = true;
    };
  }, [filePath, setBlocks]);

  if (loading) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          opacity: 0.7,
        }}
      >
        {t("Loading merge editor...")}
      </div>
    );
  }

  if (error) {
    return (
      <div
        style={{
          padding: 16,
          color: "var(--app-fg)",
          fontFamily: "var(--font-family)",
          fontSize: 13,
        }}
      >
        {error}
      </div>
    );
  }

  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        fontFamily: "var(--font-family)",
      }}
    >
      <ErrorBanner />
      {/* File path header */}
      <div
        style={{
          padding: "6px 12px",
          borderBottom: "1px solid var(--border)",
          fontSize: 13,
          opacity: 0.85,
          flexShrink: 0,
        }}
      >
        {filePath}
      </div>

      {/* Toolbar: navigation + stats */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "4px 12px",
          borderBottom: "1px solid var(--border)",
          fontSize: 12,
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <Tooltip text={t("Previous Conflict")}>
            <button
              type="button"
              onClick={goToPrevConflict}
              disabled={conflictCount === 0}
              style={navButtonStyle}
            >
              &#x25B2;
            </button>
          </Tooltip>
          <Tooltip text={t("Next Conflict")}>
            <button
              type="button"
              onClick={goToNextConflict}
              disabled={conflictCount === 0}
              style={navButtonStyle}
            >
              &#x25BC;
            </button>
          </Tooltip>
        </div>
        <span style={{ opacity: 0.7 }}>
          {t("{0} changes · {1} conflicts", changeCount, conflictCount)}
        </span>
      </div>

      {/* Main merge content */}
      <div style={{ flex: 1, minHeight: 0 }}>
        <MergeContainer
          activeBlockId={activeBlockId}
          onClearActive={() => setActiveConflictIndex(-1)}
        />
      </div>

      {/* Bottom action bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 12px",
          borderTop: "1px solid var(--border)",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", gap: 8 }}>
          <Tooltip text={t("Accept all changes from left side")} position="top">
            <button
              type="button"
              onClick={acceptAllLeft}
              disabled={conflictCount === 0}
              className="merge-btn merge-btn-secondary"
            >
              {t("Accept Left")}
            </button>
          </Tooltip>
          <Tooltip text={t("Accept all changes from right side")} position="top">
            <button
              type="button"
              onClick={acceptAllRight}
              disabled={conflictCount === 0}
              className="merge-btn merge-btn-secondary"
            >
              {t("Accept Right")}
            </button>
          </Tooltip>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Tooltip text={t("Discard changes and close")} position="top">
            <button
              type="button"
              onClick={handleCancel}
              className="merge-btn merge-btn-secondary"
            >
              {t("Cancel")}
            </button>
          </Tooltip>
          <Tooltip text={t("Save merged result and stage file")} position="top">
            <button
              type="button"
              onClick={handleApply}
              disabled={!allResolved}
              className="merge-btn merge-btn-primary"
            >
              {t("Apply")}
            </button>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}

const navButtonStyle: React.CSSProperties = {
  background: "transparent",
  border: "1px solid var(--border)",
  borderRadius: 6,
  color: "var(--app-fg)",
  padding: "2px 6px",
  fontSize: 10,
  lineHeight: 1,
};
