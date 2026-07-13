import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { bridge } from "../../shared/bridge";
import { Tooltip } from "../../shared/components/Tooltip";
import "../../shared/components/Tooltip.css";
import { t } from "../../shared/i18n";
import { useCommitStore } from "../../shared/store/commit-store";
import SparkleIcon from "~icons/codicon/sparkle";
import LoadingIcon from "~icons/codicon/loading";
import StopIcon from "~icons/codicon/debug-stop";

export function CommitMessageArea() {
  const {
    commitMessage,
    setCommitMessage,
    amend,
    setAmend,
    commit,
    commitAndPush,
    loading,
    selectedFiles,
    commitListStyle,
    skipPushConfirmation,
    changes,
    aiGenerating,
    aiConfigured,
    aiApiUrl,
    aiModel,
    generateCommitMessage,
    cancelCommitMessage,
  } = useCommitStore();

  const [showDropdown, setShowDropdown] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [recentMessages, setRecentMessages] = useState<string[]>([]);
  const [aiHover, setAiHover] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const historyBtnRef = useRef<HTMLSpanElement>(null);
  const historyDropdownRef = useRef<HTMLDivElement>(null);

  // Submit-button enablement follows the active list style:
  //  - JetBrains: files are picked via checkboxes → require selectedFiles.
  //  - VSCode: files are staged via +/- → require at least one staged file.
  //  - amend (either style): rewrites the last commit → only needs a message,
  //    no new files required.
  const hasFiles = amend
    ? true
    : commitListStyle === "vscode"
      ? changes.some((f) => f.staged)
      : selectedFiles.size > 0;
  const canCommit = commitMessage.trim().length > 0 && hasFiles && !loading;

  const handleCommit = useCallback(async () => {
    if (!canCommit) return;
    await commit();
  }, [canCommit, commit]);

  const handleCommitAndPush = useCallback(async () => {
    if (!canCommit) return;
    setShowDropdown(false);
    // 跳过确认面板 → 直接提交并推送；否则提交后打开推送确认面板
    if (skipPushConfirmation) {
      await commitAndPush();
      return;
    }
    await commit();
    await bridge.request("openPushPanel");
  }, [canCommit, commit, commitAndPush, skipPushConfirmation]);

  const handleCommitAndPushWithTags = useCallback(async () => {
    if (!canCommit) return;
    setShowDropdown(false);
    await commit();
    await bridge.request("openPushPanel", { withTags: true });
  }, [canCommit, commit]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Ctrl/Cmd + Enter to commit
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        handleCommit();
      }
    },
    [handleCommit],
  );

  const hasChanges = changes.length > 0;
  const canGenerate = hasChanges && aiConfigured && !aiGenerating;

  // Simplified opacity/cursor logic (m4) — extracted to avoid nested ternaries in JSX
  // 生成中也可点击（用于取消），故 aiClickable 包含 aiGenerating
  const aiClickable = canGenerate || !aiConfigured || aiGenerating;
  const aiBaseOpacity = aiGenerating ? 1 : aiClickable ? 0.6 : 0.3;
  const aiTooltip = aiGenerating
    ? t("Stop generating")
    : !aiApiUrl || !aiModel
      ? t("AI not configured. Click to open settings.")
      : !aiConfigured
        ? t("AI API key not set. Click to set up.")
        : t("Generate commit message with AI");

  const handleAiGenerate = useCallback(async () => {
    // 生成中再次点击 → 取消
    if (aiGenerating) {
      await cancelCommitMessage();
      return;
    }
    // 配置引导：先检查 apiUrl/model，缺失则跳转设置页；再检查 apiKey，缺失则弹输入框
    if (!aiApiUrl || !aiModel) {
      await bridge.request("openAiSettings");
      return;
    }
    if (!aiConfigured) {
      await bridge.request("setAiApiKey", {}, { timeout: 120_000 });
      return;
    }
    if (!hasChanges) return;
    await generateCommitMessage();
  }, [aiApiUrl, aiModel, aiConfigured, hasChanges, aiGenerating, generateCommitMessage, cancelCommitMessage]);

  const handleHistoryClick = useCallback(async () => {
    if (showHistory) {
      setShowHistory(false);
      return;
    }
    try {
      const messages = (await bridge.request(
        "getRecentCommitMessages",
      )) as string[];
      setRecentMessages(messages ?? []);
    } catch {
      setRecentMessages([]);
    }
    setShowHistory(true);
  }, [showHistory]);

  const handleSelectMessage = useCallback(
    (msg: string) => {
      setCommitMessage(msg);
      setShowHistory(false);
    },
    [setCommitMessage],
  );

  // Close history dropdown on outside click
  useEffect(() => {
    if (!showHistory) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      // Check if click is inside the dropdown or the button
      if (historyBtnRef.current?.contains(target)) return;
      if (historyDropdownRef.current?.contains(target)) return;
      setShowHistory(false);
    };
    // Use setTimeout to avoid the current click event triggering close immediately
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside, true);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClickOutside, true);
    };
  }, [showHistory]);

  // Close commit-and-push dropdown on outside click
  useEffect(() => {
    if (!showDropdown) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      // dropdownRef 同时包裹触发按钮和菜单，命中其中任意一个都不算 outside
      if (dropdownRef.current?.contains(target)) return;
      setShowDropdown(false);
    };
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside, true);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClickOutside, true);
    };
  }, [showDropdown]);

  return (
    <div className="commit-message-area">
      <textarea
        className="commit-message-textarea"
        placeholder={t("Commit message (Ctrl+Enter to commit)")}
        value={commitMessage}
        onChange={(e) => setCommitMessage(e.target.value)}
        onKeyDown={handleKeyDown}
        rows={5}
      />

      <div className="commit-amend-row">
        <label>
          <input
            type="checkbox"
            checked={amend}
            onChange={(e) => setAmend(e.target.checked)}
          />
          {t("Amend")}
        </label>
        {/* AI 生成按钮 */}
        <Tooltip text={aiTooltip}>
          <span
            onClick={handleAiGenerate}
            style={{
              cursor: aiClickable ? "pointer" : "default",
              display: "inline-flex",
              alignItems: "center",
              borderRadius: 3,
              padding: 2,
              opacity: aiBaseOpacity,
              transition: "background 0.15s, opacity 0.15s",
            }}
            onMouseEnter={(e) => {
              setAiHover(true);
              if (aiClickable) (e.currentTarget as HTMLElement).style.opacity = "1";
            }}
            onMouseLeave={(e) => {
              setAiHover(false);
              if (aiClickable) (e.currentTarget as HTMLElement).style.opacity = String(aiBaseOpacity);
            }}
            onMouseDown={(e) => {
              (e.currentTarget as HTMLElement).style.background =
                "var(--vscode-toolbar-activeBackground, rgba(0,0,0,0.15))";
            }}
            onMouseUp={(e) => {
              (e.currentTarget as HTMLElement).style.background = "transparent";
            }}
          >
            {aiGenerating ? (
              aiHover ? (
                <StopIcon style={{ fontSize: 14, color: "var(--vscode-errorForeground, #f48771)" }} />
              ) : (
                <LoadingIcon style={{ fontSize: 14, animation: "ai-spin 1s linear infinite" }} />
              )
            ) : (
              <SparkleIcon style={{ fontSize: 14, color: canGenerate ? "var(--vscode-textLink-foreground, #3794ff)" : undefined }} />
            )}
          </span>
        </Tooltip>
        <Tooltip text={t("Recent commit messages")}>
          <span
            ref={historyBtnRef}
            onClick={handleHistoryClick}
            style={{
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              borderRadius: 3,
              padding: 2,
              transition: "background 0.15s, opacity 0.15s",
              opacity: showHistory ? 1 : 0.6,
              background: showHistory
                ? "var(--vscode-toolbar-activeBackground, rgba(0,0,0,0.1))"
                : "transparent",
            }}
            onMouseEnter={(e) => {
              if (!showHistory)
                (e.currentTarget as HTMLElement).style.opacity = "1";
            }}
            onMouseLeave={(e) => {
              if (!showHistory)
                (e.currentTarget as HTMLElement).style.opacity = "0.6";
            }}
            onMouseDown={(e) => {
              (e.currentTarget as HTMLElement).style.background =
                "var(--vscode-toolbar-activeBackground, rgba(0,0,0,0.15))";
            }}
            onMouseUp={(e) => {
              (e.currentTarget as HTMLElement).style.background = showHistory
                ? "var(--vscode-toolbar-activeBackground, rgba(0,0,0,0.1))"
                : "transparent";
            }}
          >
            <HistoryIcon />
          </span>
        </Tooltip>
        {showHistory &&
          createPortal(
            <HistoryDropdown
              ref={historyDropdownRef}
              anchorRef={historyBtnRef}
              messages={recentMessages}
              onSelect={handleSelectMessage}
              onClose={() => setShowHistory(false)}
            />,
            document.body,
          )}
      </div>

      <div className="commit-buttons">
        <button
          type="button"
          className="commit-btn commit-btn-primary"
          disabled={!canCommit}
          onClick={handleCommit}
        >
          {t("Commit")}
        </button>

        <div className="commit-dropdown" ref={dropdownRef}>
          <button
            type="button"
            className="commit-btn commit-btn-secondary commit-split-main"
            disabled={!canCommit}
            onClick={handleCommitAndPush}
          >
            {t("Commit and Push...")}
          </button>
          <button
            type="button"
            className="commit-btn commit-btn-secondary commit-split-arrow"
            disabled={!canCommit}
            onClick={() => setShowDropdown(!showDropdown)}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <polyline points="4,6 8,10 12,6" />
            </svg>
          </button>
          {showDropdown && (
            <div className="commit-dropdown-menu">
              <button
                type="button"
                className="commit-dropdown-item"
                onClick={handleCommitAndPush}
              >
                {t("Commit and Push")}
              </button>
              <button
                type="button"
                className="commit-dropdown-item"
                onClick={handleCommitAndPushWithTags}
              >
                {t("Commit and Push with Tags")}
              </button>
              <div className="commit-dropdown-separator" />
              <button
                type="button"
                className="commit-dropdown-item"
                onClick={() => {
                  setShowDropdown(false);
                }}
              >
                {t("Cancel")}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface HistoryDropdownProps {
  anchorRef: React.RefObject<HTMLSpanElement | null>;
  messages: string[];
  onSelect: (msg: string) => void;
  onClose: () => void;
}

const HistoryDropdown = React.forwardRef<HTMLDivElement, HistoryDropdownProps>(
  ({ anchorRef, messages, onSelect, onClose }, ref) => {
    const innerRef = useRef<HTMLDivElement>(null);
    const [pos, setPos] = useState<{ bottom: number; left: number } | null>(
      null,
    );

    // Combine forwarded ref and inner ref
    const setRefs = useCallback(
      (node: HTMLDivElement | null) => {
        (innerRef as React.MutableRefObject<HTMLDivElement | null>).current =
          node;
        if (typeof ref === "function") ref(node);
        else if (ref)
          (ref as React.MutableRefObject<HTMLDivElement | null>).current = node;
      },
      [ref],
    );

    useEffect(() => {
      if (anchorRef.current) {
        const rect = anchorRef.current.getBoundingClientRect();
        // Position above the button, align right edge to viewport
        const bottom = window.innerHeight - rect.top + 4;
        const left = Math.min(rect.left, window.innerWidth - 8);
        setPos({ bottom, left });
      }
    }, [anchorRef]);

    useEffect(() => {
      const handleKey = (e: KeyboardEvent) => {
        if (e.key === "Escape") onClose();
      };
      document.addEventListener("keydown", handleKey);
      return () => document.removeEventListener("keydown", handleKey);
    }, [onClose]);

    if (!pos) return null;

    return (
      <div
        ref={setRefs}
        style={{
          position: "fixed",
          bottom: pos.bottom,
          left: 4,
          right: 4,
          zIndex: 99999,
          background: "var(--vscode-menu-background, #1e1e1e)",
          border: "1px solid var(--vscode-menu-border, #454545)",
          borderRadius: 4,
          padding: "4px 0",
          maxHeight: 250,
          overflowY: "auto",
          boxShadow: "0 -3px 12px rgba(0,0,0,0.1), 0 1px 4px rgba(0,0,0,0.06)",
        }}
      >
        {messages.length === 0 ? (
          <div
            style={{
              padding: "8px 12px",
              opacity: 0.5,
              fontSize: 12,
            }}
            >
            {t("No recent commit messages")}
          </div>
        ) : (
          messages.map((msg, i) => (
            <div
              key={`${i}-${msg}`}
              onClick={() => onSelect(msg)}
              style={{
                padding: "6px 12px",
                cursor: "pointer",
                fontSize: 12,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                color: "var(--vscode-menu-foreground, #ccc)",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.background =
                  "var(--vscode-list-hoverBackground, #2a2d2e)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.background =
                  "transparent";
              }}
              title={msg}
            >
              {msg}
            </div>
          ))
        )}
      </div>
    );
  },
);

function HistoryIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="currentColor"
      style={{ opacity: 0.5 }}
    >
      <path d="M13.507 12.324a7 7 0 0 0 .065-8.56A7 7 0 0 0 2 4.393V2H1v3.5l.5.5H5V5H2.811a6.008 6.008 0 1 1-.135 5.77l-.887.462a7 7 0 0 0 11.718 1.092zM8 4v4.5l.5.5H12v-1H9V4H8z" />
    </svg>
  );
}
