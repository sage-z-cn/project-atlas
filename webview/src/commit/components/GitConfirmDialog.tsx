import { useCommitStore } from "../../shared/store/commit-store";
import { ConfirmDialog } from "../../shared/components/ConfirmDialog";

/**
 * git 侧危险动作确认弹窗（rollback / deleteFiles / deleteStash /
 * unstashFile 覆盖确认），由 commit-store 的 gitConfirm 状态驱动。
 * 常驻 commit 面板顶层（任意 tab 均可弹出）；git 侧无 "不再询问" 配置，
 * 不渲染复选框变体。取消 / Escape / 遮罩由 store 的 cancelGitPrompt 中止。
 */
export function GitConfirmDialog() {
  const prompt = useCommitStore((s) => s.gitConfirm);
  const confirmGitPrompt = useCommitStore((s) => s.confirmGitPrompt);
  const cancelGitPrompt = useCommitStore((s) => s.cancelGitPrompt);
  if (!prompt) return null;
  return (
    <ConfirmDialog
      title={prompt.title}
      message={prompt.message}
      confirmLabel={prompt.confirmLabel}
      onConfirm={() => confirmGitPrompt()}
      onCancel={cancelGitPrompt}
    />
  );
}
