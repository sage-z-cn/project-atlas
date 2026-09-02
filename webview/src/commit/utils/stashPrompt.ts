import { bridge } from "../../shared/bridge";
import { t } from "../../shared/i18n";
import { useCommitStore } from "../../shared/store/commit-store";

/**
 * 共享的 "Stash Changes" 入口（4 处右键菜单收敛于此）：
 * 弹出可选的 stash 消息输入框 → 用户取消则静默中止 → 确认后调用
 * store.stashChanges。
 *
 * 消息为空时向 store 传 undefined（不再传本地化默认文案），由 extension
 * 侧兜底英文 "Stashed changes" —— 避免 stash message 随 UI 语言变化。
 *
 * 注意：不负责关闭调用方的菜单，onClose 由调用点自理。
 */
export async function promptAndStash(paths: string[]): Promise<void> {
  // Name is optional: cancel aborts, empty leaves the message undefined.
  const result = await bridge.request<{ value: string | null }>("showInputBox", {
    prompt: t("Enter stash message (optional):"),
    placeHolder: t("Stashed changes"),
  });
  if (result.value === null) return;
  const message = result.value.trim() || undefined;
  await useCommitStore.getState().stashChanges(message, paths);
}
