import * as vscode from "vscode";
import type { GitHandlerContext } from "../gitContext";

/**
 * Git Atlas config bridge handlers.
 *
 * The webview runs in an isolated context without access to the VS Code
 * configuration API, so these handlers expose the relevant subset of the
 * `gitAtlas.*` configuration. After a successful write, the change is
 * broadcast via `gitConfigChanged` so every webview can hot-reload the value
 * (the same event is also fired by the global `onDidChangeConfiguration`
 * listener in setupGit, so externally-edited settings propagate too).
 */
export type CommitListStyle = "vscode" | "jetbrains";
export type CommitBadgeMode = "total" | "current" | "off";

export function registerConfigHandlers(ctx: GitHandlerContext): void {
  const { messageRouter } = ctx;

  // 读取 gitAtlas 配置，返回 webview 关心的子集
  messageRouter.handle("getGitConfig", async () => {
    const config = vscode.workspace.getConfiguration("gitAtlas");
    const commitListStyle = config.get<CommitListStyle>(
      "commitListStyle",
      "vscode",
    );
    const commitBadgeMode = config.get<CommitBadgeMode>(
      "commitBadgeMode",
      "current",
    );
    return { commitListStyle, commitBadgeMode };
  });

  // 写入配置并广播事件，让所有 webview 热刷新
  messageRouter.handle("setGitConfig", async (params) => {
    const config = vscode.workspace.getConfiguration("gitAtlas");
    if (typeof params?.commitListStyle === "string") {
      await config.update(
        "commitListStyle",
        params.commitListStyle as CommitListStyle,
        vscode.ConfigurationTarget.Global,
      );
    }
    if (typeof params?.commitBadgeMode === "string") {
      await config.update(
        "commitBadgeMode",
        params.commitBadgeMode as CommitBadgeMode,
        vscode.ConfigurationTarget.Global,
      );
    }
    // 广播，前端收到后重拉 getGitConfig
    messageRouter.broadcastEvent("gitConfigChanged", {});
    return { success: true };
  });
}
