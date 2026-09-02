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
 * 自动清空并获得焦点，范围选择重置为默认"全选"）。
 *
 * 结果语义（归一发生在 store.resolveStashPrompt）：Esc / backdrop / 取消
 * 按钮 = null（取消，promptAndStash 静默中止）；"贮藏" 按钮或 Enter =
 * { message, paths }（消息空白归一 undefined，extension 侧兜底英文
 * "Stashed changes"；paths 为确认时按所选范围结算的最终贮藏范围）
 * —— 因此确认按钮永不禁用。
 *
 * 范围选择区（stashPrompt.paths === null 且 vscode 列表风格）：
 * - 全选 → paths 结算 null（全量，走 stashChanges 的 filePaths=undefined）
 * - 更改列表 → changes 过滤 !staged 且非 conflicted（与 VscodeCommitList
 *   的 Changes 组同口径；conflicted 混入会让 git stash 报 needs merge
 *   整批失败）
 * - 暂存的更改 → changes 过滤 staged（与 Staged Changes 组同口径）
 * 某范围为空时该选项禁用（覆盖"确认为空范围"的防御）；文件计数随选
 * 择实时联动，作为弱化元信息与范围选择组同区展示（右键入口无选择区
 * 时独立成行）。jetbrains 风格 / 右键入口不出现选择区，行为不变。
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
  const [value, setValue] = useState("");
  const [scope, setScope] = useState<StashScope>("all");
  const inputRef = useRef<HTMLInputElement>(null);

  // 范围选择区仅在工具栏全量入口（paths === null）+ vscode 列表风格出现；
  // 右键入口（paths 快照）与 jetbrains 风格保持直接贮藏，scope 恒 "all"。
  const showScope = paths === null && commitListStyle === "vscode";

  // 与 VscodeCommitList 分组同口径：Changes 组 = 未暂存且非 conflicted
  // （含未跟踪）；Staged Changes 组 = 已暂存。
  const unstagedPaths = changes
    .filter((f) => !f.staged && f.status !== "conflicted")
    .map((f) => f.path);
  const stagedPaths = changes.filter((f) => f.staged).map((f) => f.path);

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

  const cancel = () => resolveStashPrompt(null);
  const confirm = () => resolveStashPrompt(value, resolvedPaths);

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
          className="commit-error-close"
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
                disabled={changes.length === 0}
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
            confirm();
          }
        }}
      />

      <div className="new-version-prompt-actions">
        <span className="new-version-prompt-spacer" />
        <button type="button" className="btn btn-secondary" onClick={cancel}>
          {t("Cancel")}
        </button>
        <button type="button" className="btn btn-primary" onClick={confirm}>
          {t("Stash")}
        </button>
      </div>
    </ModalOverlay>
  );
}
