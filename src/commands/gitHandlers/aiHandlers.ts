import * as vscode from "vscode";
import type { GitHandlerContext } from "../gitContext";
import { requireGit } from "../gitContext";
import { AiCommitService } from "../../ai/aiCommitService";

export function registerAiHandlers(ctx: GitHandlerContext): void {
  const { messageRouter, context } = ctx;
  const aiService = new AiCommitService(context);

  // 查询 AI 配置状态（不返回 key 明文）
  messageRouter.handle("getAiConfig", async () => {
    return aiService.getStatus();
  });

  // 生成 commit message
  messageRouter.handle(
    "generateCommitMessage",
    requireGit(ctx, async (gitService, params) => {
      const commitListStyle = (params.commitListStyle as "vscode" | "jetbrains") ?? "vscode";
      const selectedFiles = (params.selectedFiles as string[]) ?? [];

      const cfg = await aiService.getConfig();
      if (!cfg) {
        throw new Error("AI is not configured. Set API URL, model, and API key first.");
      }

      const diffContext = await aiService.collectDiff(
        gitService,
        commitListStyle,
        selectedFiles,
      );

      if (!diffContext.diff.trim() && diffContext.fileSummary.length === 0) {
        throw new Error("No changes to generate a commit message from.");
      }

      // AI 生成不是 git 操作，不触发全局 operationStart/End 进度条；
      // commit 区有自己的 aiGenerating spinner 作为加载指示。
      const message = await aiService.generateMessage(diffContext, gitService, cfg);
      return { message, source: diffContext.source };
    }),
  );

  // 取消进行中的 AI 生成（中止 in-flight 的 fetch + 重试循环）
  messageRouter.handle("cancelCommitMessageGeneration", async () => {
    aiService.cancelGeneration();
    return { success: true };
  });

  // 通过 webview 触发 API Key 设置（命令委托）
  messageRouter.handle("setAiApiKey", async () => {
    await vscode.commands.executeCommand("git-atlas.setAiApiKey");
    return aiService.getStatus();
  });

  // 打开 AI 配置设置页（让用户填写 apiUrl / model）
  messageRouter.handle("openAiSettings", async () => {
    await vscode.commands.executeCommand(
      "workbench.action.openSettings",
      "gitAtlas.aiCommit",
    );
    return { success: true };
  });

  // 打开 Git Atlas 配置设置页
  messageRouter.handle("openGitSettings", async () => {
    await vscode.commands.executeCommand(
      "workbench.action.openSettings",
      "gitAtlas",
    );
    return { success: true };
  });
}
