import LoadingIcon from "~icons/codicon/loading";
import { t } from "../../shared/i18n";
import { useDelayedVisible } from "../../shared/hooks/useDelayedVisible";
import { useCommitStore } from "../../shared/store/commit-store";
import type { BulkOperationKind } from "../../shared/store/commit-store";

/**
 * 遮罩上升沿延迟（防闪烁）：更快完成的批量操作完全不出现等待动画。
 * 与 ProgressBar / tasks 加载态同一机制，略放宽到 400ms——能走到这条
 * 路径的操作都已预判为慢操作，要么不出现，要么大概率真的久。
 */
const BULK_OVERLAY_DELAY_MS = 400;

/** 操作种类 → 等待文案（t() 预键，用户语言，不含命令名）。 */
const BULK_OP_MESSAGES: Record<BulkOperationKind, (count: number) => string> = {
  stage: (count) => t("Staging {0} files...", count.toLocaleString()),
  unstage: (count) => t("Unstaging {0} files...", count.toLocaleString()),
  discard: (count) =>
    t("Discarding changes in {0} files...", count.toLocaleString()),
  stash: (count) => t("Stashing {0} files...", count.toLocaleString()),
  // unstash 的影响文件数无自然来源（代理值不代表恢复的文件数），不展示数字。
  unstash: () => t("Restoring stashed changes..."),
};

/**
 * 批量 git 操作等待遮罩：大批文件暂存/取消暂存/放弃/贮藏/取消贮藏
 * 进行中，覆盖在更改列表区域（commit-file-list 的包裹层）上方的
 * 等待状态——旋转进度图标 + 含文件数的说明文案，并阻断列表交互
 * （遮罩拦截指针事件，等待期间无法再次触发批量操作）。提交信息
 * 输入框等列表外区域不受影响。
 *
 * 性能约束：本组件只字段级订阅 bulkOperation 单字段，等待状态的
 * 置位/清除不会引起 7000 行虚拟列表的任何重渲染；延迟显示由
 * useDelayedVisible 完成，快操作全程不可见。
 */
export function BulkOperationOverlay() {
  const bulkOperation = useCommitStore((s) => s.bulkOperation);
  const visible = useDelayedVisible(
    bulkOperation !== null,
    BULK_OVERLAY_DELAY_MS,
  );
  if (!visible || bulkOperation === null) return null;
  return (
    <div className="commit-bulk-overlay" role="status">
      <LoadingIcon width={16} height={16} className="commit-bulk-spinner" />
      <span className="commit-bulk-message">
        {BULK_OP_MESSAGES[bulkOperation.kind](bulkOperation.count)}
      </span>
    </div>
  );
}
