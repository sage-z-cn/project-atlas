import * as vscode from "vscode";
import { AI_SECRET_KEY } from "./aiClient";
import { logger } from "../utils/logger";

/**
 * AI 配置一次性迁移：gitAtlas.aiCommit.* → projectAtlas.ai.*。
 *
 * - 配置：逐键将旧键 user/workspace 级值复制到新键对应级别（新键已有值
 *   时跳过），复制后将旧键在该级别清除。
 * - Secret：新 key 无值且旧 key `gitAtlas.aiCommit.apiKey` 有值时，存新删旧。
 * - 完成后在 globalState 设 `projectAtlas.ai.migrated` 标记，仅执行一次。
 *
 * 任何单步失败仅 logger.warn，不阻断激活。
 */

const MIGRATION_FLAG_KEY = "projectAtlas.ai.migrated";
const OLD_SECRET_KEY = "gitAtlas.aiCommit.apiKey";

const CONFIG_KEY_PAIRS: [oldKey: string, newKey: string][] = [
  ["gitAtlas.aiCommit.apiUrl", "projectAtlas.ai.apiUrl"],
  ["gitAtlas.aiCommit.model", "projectAtlas.ai.model"],
  ["gitAtlas.aiCommit.language", "projectAtlas.ai.language"],
  ["gitAtlas.aiCommit.maxDiffChars", "projectAtlas.ai.maxDiffChars"],
  ["gitAtlas.aiCommit.customInstructions", "projectAtlas.ai.customInstructions"],
  ["gitAtlas.aiCommit.timeout", "projectAtlas.ai.timeout"],
  ["gitAtlas.aiCommit.enableThinking", "projectAtlas.ai.enableThinking"],
];

interface MigrationLevel {
  value: unknown;
  target: vscode.ConfigurationTarget;
}

export async function migrateAiConfig(context: vscode.ExtensionContext): Promise<void> {
  if (context.globalState.get(MIGRATION_FLAG_KEY)) return;

  try {
    const copiedCount = await migrateConfigValues();
    const secretMigrated = await migrateSecret(context);

    await context.globalState.update(MIGRATION_FLAG_KEY, true);
    logger.log(
      `[ai-migration] gitAtlas.aiCommit.* -> projectAtlas.ai.* done: ${copiedCount} setting value(s) copied, secret ${secretMigrated ? "migrated" : "skipped"}`,
    );
  } catch (err) {
    // 兜底：迁移逻辑自身异常不阻断激活（内部各步已有独立 catch）
    logger.warn(`[ai-migration] unexpected failure: ${String(err).slice(0, 200)}`);
  }
}

/** 迁移 7 对配置键，返回复制的取值个数。 */
async function migrateConfigValues(): Promise<number> {
  const config = vscode.workspace.getConfiguration();
  let copied = 0;

  for (const [oldKey, newKey] of CONFIG_KEY_PAIRS) {
    try {
      const oldInspection = config.inspect(oldKey);
      if (!oldInspection) continue;

      const levels: MigrationLevel[] = [];
      if (oldInspection.globalValue !== undefined) {
        levels.push({ value: oldInspection.globalValue, target: vscode.ConfigurationTarget.Global });
      }
      if (oldInspection.workspaceValue !== undefined) {
        levels.push({ value: oldInspection.workspaceValue, target: vscode.ConfigurationTarget.Workspace });
      }

      for (const { value, target } of levels) {
        const newInspection = config.inspect(newKey);
        const newHasValue = target === vscode.ConfigurationTarget.Global
          ? newInspection?.globalValue !== undefined
          : newInspection?.workspaceValue !== undefined;
        if (newHasValue) continue;

        await config.update(newKey, value, target);
        await config.update(oldKey, undefined, target);
        copied++;
      }
    } catch (err) {
      logger.warn(
        `[ai-migration] failed to migrate config "${oldKey}": ${String(err).slice(0, 200)}`,
      );
    }
  }

  return copied;
}

/** 迁移 SecretStorage 中的 API key，返回是否发生迁移。 */
async function migrateSecret(context: vscode.ExtensionContext): Promise<boolean> {
  try {
    const existing = await context.secrets.get(AI_SECRET_KEY);
    if (existing) return false;

    const oldValue = await context.secrets.get(OLD_SECRET_KEY);
    if (!oldValue) return false;

    await context.secrets.store(AI_SECRET_KEY, oldValue);
    await context.secrets.delete(OLD_SECRET_KEY);
    return true;
  } catch (err) {
    logger.warn(
      `[ai-migration] failed to migrate API key secret: ${String(err).slice(0, 200)}`,
    );
    return false;
  }
}
