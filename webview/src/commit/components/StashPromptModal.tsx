import { useRef, useState } from "react";
import { t } from "../../shared/i18n";
import { useCommitStore } from "../../shared/store/commit-store";
import { ModalOverlay } from "./Modal";
import CloseIcon from "~icons/codicon/close";

// ── Stash message prompt modal ───────────────────────────────────────────────

/** 贮藏范围（仅 vscode 风格 + 工具栏全量入口出现选择区，其余入口恒 "all"）。 */
type StashScope = "all" | "changes" | "staged";

/**
 * "Stash Changes" 的消息输入弹窗（webview 内实现，替代原生 showInputBox；
 * 4 处右键菜单（选中文件）与工具栏贮藏按钮（全量）经 utils/stashPrompt.ts
 * 的 promptAndStash 收敛至此）。
 *
 * 常驻 commit 面板顶层（见 App.tsx），由 commit-store 的 stashPrompt.open
 * 驱动：open 翻为 true 时挂载 StashPromptCard（每次打开重新 mount，输入
 * 自动清空并获得焦点，范围选择按打开时的列表状态 lazy 取首个可用范围）。
 *
 * 结果语义（归一发生在 store.resolveStashPrompt）：Esc / backdrop / 取消
 * 按钮 = null（取消，promptAndStash 静默中止）；"贮藏" 按钮或 Enter =
 * { message, paths, stagedOnly }（消息空白归一 undefined，extension 侧
 * 兜底英文 "Stashed changes"；paths 为确认时按所选范围结算的最终贮藏
 * 范围；stagedOnly = 所选范围为「暂存的更改」）—— 除三个范围全部不可
 * 用外确认按钮不禁用（见下）。
 *
 * 范围选择区（stashPrompt.paths === null 且 vscode 列表风格）：
 * - 全选 → paths 结算 null（全量，走 stashChanges 的 filePaths=undefined）；
 *   存在冲突文件时禁用（conflicted 混入会让 git stash 报 needs merge
 *   整批失败），scope 初始值 lazy 落到首个可用范围，避免默认落在被禁
 *   用的 All 上
 * - 更改列表 → changes 过滤 !staged 且非 conflicted（与 VscodeCommitList
 *   的 Changes 组同口径）；按路径全量贮藏 —— 同一文件已暂存的改动会被
 *   一并带出，与 Staged 范围有交集时显示弱化提示行说明
 * - 暂存的更改 → changes 过滤 staged 且非 conflicted，确认时 stagedOnly
 *   = true（走后端 --staged 专用命令，只贮藏 index 内容）
 * 某范围为空时该选项禁用（覆盖"确认为空范围"的防御）；三个范围全部
 * 不可用（有冲突且无任何可贮藏文件）时禁用确认按钮与 Enter 提交 ——
 * 仅作用于该入口（vscode 工具栏全量），右键入口的 paths 快照已由
 * promptAndStash 预滤冲突，不受影响。文件计数随选择实时联动，作为弱化
 * 元信息与范围选择组同区展示（右键入口无选择区时独立成行）。
 * jetbrains 风格 / 右键入口不出现选择区，行为不变。
 */
export function StashPromptModal() {
  const open = useCommitStore((s) => s.stashPrompt.open);
  if (!open) return null;
  return <StashPromptCard />;
}

function StashPromptCard() {
  const paths = useCommitStore((s) => s.stashPrompt.paths);
  const changes = useCommitStore((s) => s.changes);
  const commitListStyle = useCommitStore((s) => s.commitListStyle);
  const resolveStashPrompt = useCommitStore((s) => s.resolveStashPrompt);
  const inputRef = useRef<HTMLInputElement>(null);

  // 与 VscodeCommitList 分组同口径：Changes 组 = 未暂存且非 conflicted
  // （含未跟踪）；Staged Changes 组 = 已暂存且非 conflicted（conflicted
  // 在 index 中 unmerged，两个范围都无法贮藏）。
  const hasConflicts = changes.some((f) => f.status === "conflicted");
  const unstagedPaths = changes
    .filter((f) => !f.staged && f.status !== "conflicted")
    .map((f) => f.path);
  const stagedPaths = changes
    .filter((f) => f.staged && f.status !== "conflicted")
    .map((f) => f.path);

  const [value, setValue] = useState("");
  // lazy 初始值：存在冲突时 All 被禁用，落到首个可用范围（Changes →
  // Staged Changes）；全部不可用时保持 "all"（确认按钮另行禁用）。
  const [scope, setScope] = useState<StashScope>(() =>
    hasConflicts
      ? unstagedPaths.length > 0
        ? "changes"
        : stagedPaths.length > 0
          ? "staged"
          : "all"
      : "all",
  );

  // 范围选择区仅在工具栏全量入口（paths === null）+ vscode 列表风格出现；
  // 右键入口（paths 快照）与 jetbrains 风格保持直接贮藏，scope 恒 "all"。
  const showScope = paths === null && commitListStyle === "vscode";

  // 确认时结算的最终贮藏范围：null = 全量。无选择区时 scope 恒 "all"，
  // 即右键入口回传 paths 快照、jetbrains 工具栏保持 null 全量 —— 三种
  // 入口在此统一。
  const resolvedPaths =
    scope === "all"
      ? paths
      : scope === "changes"
        ? unstagedPaths
        : stagedPaths;

  // 计数随范围联动：resolvedPaths === null（全量）= changes.length（含
  // 未跟踪）；否则 = 过滤后数量（右键入口 = paths.length 快照）。为 0 时
  // 不显示计数。
  const fileCount = resolvedPaths === null ? changes.length : resolvedPaths.length;

  // "changes" 范围按路径全量贮藏：同一文件的 staged+unstaged 改动都会被
  // 带出，所选范围与 Staged 有交集（同一文件既有已暂存又有未暂存改动）
  // 时需提示。
  const stagedPathSet = new Set(stagedPaths);
  const changesOverlapsStaged = unstagedPaths.some((p) =>
    stagedPathSet.has(p),
  );

  // 三个范围全部不可用（有冲突且无任何可贮藏文件）→ 禁用确认按钮与
  // Enter 提交。仅作用于 showScope（vscode 工具栏全量入口）；右键入口
  // （paths 快照，已由 promptAndStash 预滤）不受影响。
  const allScopesUnavailable =
    showScope &&
    hasConflicts &&
    unstagedPaths.length === 0 &&
    stagedPaths.length === 0;

  const cancel = () => resolveStashPrompt(null);
  const confirm = () =>
    resolveStashPrompt(value, resolvedPaths, scope === "staged");

  return (
    <ModalOverlay
      onClose={cancel}
      ariaLabel={t("Stash Changes...")}
      initialFocusRef={inputRef}
      cardClass="modal-sm"
    >
      <div className="new-version-modal-head">
        <span className="new-version-modal-title">
          {t("Stash Changes...")}
        </span>
        <button
          type="button"
          className="commit-message-banner-close"
          aria-label={t("Cancel")}
          onClick={cancel}
        >
          <CloseIcon />
        </button>
      </div>

      {/* 范围选择区 + 文件计数同插槽：计数归属范围选择（随所选范围
          联动），弱化展示；右键入口（无选择组）时计数独立成行。整个
          区块在无选择区且计数为 0 时不渲染（.modal 子项间隙不落空）。 */}
      {(showScope || fileCount > 0) && (
        <div className="stash-prompt-scope-row">
          {showScope && (
            <div
              className="stash-prompt-seg-group"
              role="radiogroup"
              aria-label={t("Stash Changes...")}
            >
              <button
                type="button"
                role="radio"
                aria-checked={scope === "all"}
                className={`stash-prompt-seg-btn${scope === "all" ? " active" : ""}`}
                disabled={changes.length === 0 || hasConflicts}
                onClick={() => setScope("all")}
              >
                {t("All Changes")}
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={scope === "changes"}
                className={`stash-prompt-seg-btn${scope === "changes" ? " active" : ""}`}
                disabled={unstagedPaths.length === 0}
                onClick={() => setScope("changes")}
              >
                {t("Changes")}
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={scope === "staged"}
                className={`stash-prompt-seg-btn${scope === "staged" ? " active" : ""}`}
                disabled={stagedPaths.length === 0}
                onClick={() => setScope("staged")}
              >
                {t("Staged Changes")}
              </button>
            </div>
          )}
          {fileCount > 0 && (
            <span className="stash-prompt-count">{t("{0} file(s)", fileCount)}</span>
          )}
        </div>
      )}

      {/* "changes" 范围与 Staged 有交集时：按路径贮藏会连带已暂存改动，
          弱化小字提示。 */}
      {showScope && scope === "changes" && changesOverlapsStaged && (
        <div className="new-version-prompt-help">
          {t(
            "Stashing will include all changes to the selected files, including staged ones.",
          )}
        </div>
      )}

      <div className="new-version-prompt-help">
        {t("Enter stash message (optional):")}
      </div>

      <input
        ref={inputRef}
        type="text"
        className="stash-prompt-input"
        value={value}
        placeholder={t("Stashed changes")}
        spellCheck={false}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (!allScopesUnavailable) confirm();
          }
        }}
      />

      <div className="new-version-prompt-actions">
        <span className="new-version-prompt-spacer" />
        <button type="button" className="btn btn-secondary" onClick={cancel}>
          {t("Cancel")}
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={confirm}
          disabled={allScopesUnavailable}
        >
          {t("Stash")}
        </button>
      </div>
    </ModalOverlay>
  );
}
