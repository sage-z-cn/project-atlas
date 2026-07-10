import * as vscode from "vscode";
import type { GitHandlerContext } from "./gitContext";
import { AI_SECRET_KEY } from "../ai/aiCommitService";

export function registerAiCommands(ctx: GitHandlerContext): void {
  ctx.context.subscriptions.push(
    vscode.commands.registerCommand("git-atlas.setAiApiKey", async () => {
      const key = await vscode.window.showInputBox({
        prompt: vscode.l10n.t("Enter your AI API key"),
        password: true,
        placeHolder: "sk-...",
        ignoreFocusOut: true,
      });
      if (key !== undefined) {
        await ctx.context.secrets.store(AI_SECRET_KEY, key);
        vscode.window.showInformationMessage(vscode.l10n.t("AI API key saved."));
        ctx.messageRouter.broadcastEvent("aiConfigChanged", {});
      }
    }),
  );

  ctx.context.subscriptions.push(
    vscode.commands.registerCommand("git-atlas.clearAiApiKey", async () => {
      await ctx.context.secrets.delete(AI_SECRET_KEY);
      vscode.window.showInformationMessage(vscode.l10n.t("AI API key cleared."));
      ctx.messageRouter.broadcastEvent("aiConfigChanged", {});
    }),
  );
}
