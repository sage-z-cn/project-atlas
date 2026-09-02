import { useCommitStore } from "../../shared/store/commit-store";

/**
 * 共享的 "Stash Changes" 入口（4 处右键菜单 + commit 工具栏的贮藏按钮
 * 收敛于此）：弹出 webview 内的 stash 消息弹窗（StashPromptModal）→
 * 用户取消则静默中止 → 确认后调用 store.stashChanges。
 *
 * paths 入参语义：string[] = 贮藏选中文件（右键菜单）；undefined = 全量
 * 入口（工具栏按钮）。undefined 归一为 null 写入 stashPrompt 状态
 * （openStashPrompt 的全量标记）。
 *
 * 最终贮藏范围在弹窗确认时结算（StashPromptResult.paths）：右键入口
 * 原样回传快照；工具栏全量入口在 vscode 列表风格下经弹窗内范围选择区
 * （全选 / Changes / Staged Changes）过滤出最终 paths，jetbrains 风格
 * 保持全量。null（全量）映射回 stashChanges 的 filePaths=undefined 分支
 * —— 绝不能传 []（store/后端对空数组是 no-op 防护，会导致静默失败；
 * 空范围选项在弹窗内已禁用，正常流程不会结算出 []）。
 *
 * 消息为空（确认但未输入）时向 store 传 undefined（不再传本地化默认
 * 文案），由 extension 侧兜底英文 "Stashed changes" —— 避免 stash
 * message 随 UI 语言变化。
 *
 * 注意：不负责关闭调用方的菜单，onClose 由调用点自理。
 */
export async function promptAndStash(
  paths: string[] | undefined,
): Promise<void> {
  // Cancel (null) aborts; confirm resolves { message, paths }.
  const result = await useCommitStore
    .getState()
    .openStashPrompt(paths ?? null);
  if (result === null) return;
  await useCommitStore
    .getState()
    .stashChanges(result.message, result.paths ?? undefined);
}
