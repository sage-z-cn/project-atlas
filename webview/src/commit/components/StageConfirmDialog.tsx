import { useCommitStore } from "../../shared/store/commit-store";
import { ConfirmDialog } from "../../shared/components/ConfirmDialog";

/**
 * 「无已暂存更改时暂存全部并提交」的确认弹窗，由 commit-store 的
 * stageConfirm 状态驱动，常驻 commit 面板顶层（任意 tab 均可弹出）。
 * 非破坏性动作，主按钮走 primary 蓝（danger=false）。取消 / Escape /
 * 遮罩由 store 的 cancelStagePrompt 结算为 false。
 */
export function StageConfirmDialog() {
  const prompt = useCommitStore((s) => s.stageConfirm);
  const confirmStagePrompt = useCommitStore((s) => s.confirmStagePrompt);
  const cancelStagePrompt = useCommitStore((s) => s.cancelStagePrompt);
  if (!prompt) return null;
  return (
    <ConfirmDialog
      title={prompt.title}
      message={prompt.message}
      confirmLabel={prompt.confirmLabel}
      danger={false}
      onConfirm={() => confirmStagePrompt()}
      onCancel={cancelStagePrompt}
    />
  );
}
