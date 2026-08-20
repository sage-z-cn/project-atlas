import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import type { GitHandlerContext } from "../gitContext";
import { requireGit } from "../gitContext";
import type { GitService } from "../../git/gitService";
import type { NewVersionCommitSummary } from "../../git/types";
import { readAiSettings } from "../../ai/aiClient";
import {
  generateNewVersionChangelog,
  getEffectiveNewVersionPrompt,
  suggestBump,
} from "../../ai/newVersionNotesService";

/**
 * New Version（新版本）handlers — commit 面板 newVersion tab 的后端。
 *
 * 依赖：
 * - gitService.getTags / getLogRange / commitPaths / createTag / pushTag /
 *   push / getWorkingTreeChanges / stageFiles（仓库根 = gitService.cwd）
 * - aiClient.readAiSettings + newVersionNotesService（changelog 生成 / bump 建议）
 *
 * 文件读写（package.json / CHANGELOG*）用 node:fs 直读仓库根，属扩展侧
 * Node 环境，webview 不可用这些 API，故全部在 handler 内完成。
 */

/** repo 根 changelog 文件名（相对路径）或 null。 */
function findChangelogFile(repoRoot: string): string | null {
  try {
    const entries = fs.readdirSync(repoRoot, { withFileTypes: true });
    const hit = entries.find(
      (e) => e.isFile() && e.name.toLowerCase().includes("changelog"),
    );
    return hit?.name ?? null;
  } catch {
    return null;
  }
}

/** repo 根 package.json 的 version 字段；无文件 / 无字段 / 解析失败 → null。 */
function readPackageVersion(repoRoot: string): string | null {
  try {
    const raw = fs.readFileSync(path.join(repoRoot, "package.json"), "utf-8");
    const pkg = JSON.parse(raw) as { version?: unknown };
    return typeof pkg.version === "string" ? pkg.version : null;
  } catch {
    return null;
  }
}

/** CJK 字符占比 > 30% → zh，否则 en。 */
function detectChangelogLanguage(content: string): "zh" | "en" {
  const cjkCount = (
    content.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) ?? []
  ).length;
  return content.length > 0 && cjkCount / content.length > 0.3 ? "zh" : "en";
}

/** 读 changelog 内容（语言检测 + 前 40 行摘录）；读取失败按无文件处理。 */
function readChangelogMeta(
  repoRoot: string,
  changelogFile: string | null,
): { changelogLanguage: "zh" | "en"; changelogExcerpt: string | undefined } {
  if (!changelogFile) {
    return { changelogLanguage: "zh", changelogExcerpt: undefined };
  }
  try {
    const content = fs.readFileSync(
      path.join(repoRoot, changelogFile),
      "utf-8",
    );
    return {
      changelogLanguage: detectChangelogLanguage(content),
      changelogExcerpt: content.split("\n").slice(0, 40).join("\n"),
    };
  } catch {
    return { changelogLanguage: "zh", changelogExcerpt: undefined };
  }
}

interface NewVersionContextInputs {
  lastTag: string | null;
  /**
   * true = 仓库有 tag 但没有一个在 HEAD 历史上（如最新 tag 打在已放弃的
   * 分支上）。此时 lastTag 为 null、commits 为全量历史，webview 需提示
   * 列表可能包含旧提交。
   */
  lastTagDetached: boolean;
  /** lastTagDetached 时被跳过的"最新"tag 名（警告文案用），其余场景为 undefined。 */
  detachedTagName?: string;
  commits: NewVersionCommitSummary[];
  changelogFile: string | null;
  changelogLanguage: "zh" | "en";
  changelogExcerpt: string | undefined;
}

/**
 * getNewVersionContext / generateNewVersionChangelog 共用的采集逻辑：
 * lastTag + since-tag commits + changelog 文件与语言 + 风格摘录。
 */
async function collectNewVersionContext(
  gitService: GitService,
): Promise<NewVersionContextInputs> {
  // getTags() 按 --sort=-creatordate 排序（新→旧）。取"最新且在 HEAD
  // 历史上"的 tag 作为 lastTag——直接取 tags[0] 会在最新 tag 打在已放弃
  // 的分支上时，把 HEAD 可达而 tag 不可达的大量提交误标为"待纳入新版本"。
  // 附注 tag 传 tag 名即可：isAncestor 内 git 会自动解引用到提交。
  // tags 通常个位数，逐个 merge-base 可接受；找到即停。
  const tags = await gitService.getTags();
  let lastTag: string | null = null;
  for (const tag of tags) {
    if (await gitService.isAncestor(tag.name, "HEAD")) {
      lastTag = tag.name;
      break;
    }
  }
  const lastTagDetached = tags.length > 0 && lastTag === null;
  const detachedTagName = lastTagDetached
    ? (tags[0]?.name ?? undefined)
    : undefined;
  const commits = await gitService.getLogRange(lastTag);
  const changelogFile = findChangelogFile(gitService.cwd);
  const { changelogLanguage, changelogExcerpt } = readChangelogMeta(
    gitService.cwd,
    changelogFile,
  );
  return {
    lastTag,
    lastTagDetached,
    detachedTagName,
    commits,
    changelogFile,
    changelogLanguage,
    changelogExcerpt,
  };
}

/** 读 projectAtlas.ai.newVersionPrompt 原始配置值（未回退默认）。 */
function getRawNewVersionPrompt(): string {
  return vscode.workspace
    .getConfiguration("projectAtlas.ai")
    .get<string>("newVersionPrompt", "");
}

export function registerNewVersionHandlers(ctx: GitHandlerContext): void {
  const { messageRouter } = ctx;

  // 当前进行中的 changelog 生成的 AbortController；null 表示无在途请求。
  // 模式照搬 AiCommitService.currentAbort（见 aiHandlers 取消链路）。
  let newVersionAbort: AbortController | null = null;

  // 新版本 tab 首屏数据
  messageRouter.handle(
    "getNewVersionContext",
    requireGit(ctx, async (gitService) => {
      const { lastTag, lastTagDetached, detachedTagName, commits, changelogFile, changelogLanguage } =
        await collectNewVersionContext(gitService);
      const rawPrompt = getRawNewVersionPrompt();
      const settings = await readAiSettings(ctx.context);
      return {
        currentVersion: readPackageVersion(gitService.cwd),
        lastTag,
        lastTagDetached,
        detachedTagName,
        commits,
        changelogFile,
        changelogLanguage,
        suggestedBump: suggestBump(commits.map((c) => c.subject)),
        effectivePrompt: getEffectiveNewVersionPrompt(rawPrompt),
        promptCustomized: rawPrompt.trim().length > 0,
        aiConfigured: !!(
          settings.apiUrl &&
          settings.model &&
          settings.apiKey
        ),
      };
    }),
  );

  // AI 生成新版本 changelog
  messageRouter.handle(
    "generateNewVersionChangelog",
    requireGit(ctx, async (gitService, params) => {
      const includeFiles =
        (params.includeFiles as { path: string; status: string }[] | undefined) ??
        [];

      // Webview 可手动指定 changelog 语言（chip 覆盖）；未传时用文件内容检测值。
      const languageOverride = params.language as "zh" | "en" | undefined;
      if (languageOverride !== undefined && !["zh", "en"].includes(languageOverride)) {
        throw new Error(vscode.l10n.t("Invalid language. Use \"zh\" or \"en\"."));
      }

      const cfg = await readAiSettings(ctx.context);
      if (!cfg.apiUrl || !cfg.model || !cfg.apiKey) {
        throw new Error(
          vscode.l10n.t(
            "AI is not configured. Set API URL, model, and API key first.",
          ),
        );
      }

      // 建立本次生成的 AbortController 并登记，cancel handler 可据此中止。
      const controller = new AbortController();
      newVersionAbort = controller;

      try {
        const { commits, changelogLanguage, changelogExcerpt } =
          await collectNewVersionContext(gitService);
        const changelog = await generateNewVersionChangelog(
          cfg,
          {
            commits,
            fileChanges: includeFiles,
            changelogExcerpt,
          },
          languageOverride ?? changelogLanguage,
          getEffectiveNewVersionPrompt(getRawNewVersionPrompt()),
          controller.signal,
        );
        return { changelog };
      } finally {
        if (newVersionAbort === controller) {
          newVersionAbort = null;
        }
      }
    }),
  );

  // 取消进行中的 changelog 生成（中止 in-flight 的 fetch + 重试循环）
  messageRouter.handle(
    "cancelNewVersionChangelogGeneration",
    requireGit(ctx, async () => {
      newVersionAbort?.abort();
      return { success: true };
    }),
  );

  // 创建新版本：changelog / package.json 更新 + 提交 + 打 tag
  messageRouter.handle(
    "createNewVersion",
    requireGit(ctx, async (gitService, params) => {
      const version = ((params.version as string | undefined) ?? "").trim();
      const tagName = ((params.tagName as string | undefined) ?? "").trim();
      const commitMessage =
        ((params.commitMessage as string | undefined) ?? "").trim();
      const changelogEntry =
        (params.changelogEntry as string | undefined) ?? "";
      const updatePackageJson =
        (params.updatePackageJson as boolean | undefined) ?? false;

      const repoRoot = gitService.cwd;

      // 1. 防御校验
      const tags = await gitService.getTags();
      if (tags.some((t) => t.name === tagName)) {
        throw new Error(
          vscode.l10n.t('Tag "{0}" already exists. Choose another tag name.', tagName),
        );
      }
      const changes = await gitService.getWorkingTreeChanges();
      if (changes.some((f) => f.status === "conflicted")) {
        throw new Error(
          vscode.l10n.t("Resolve merge conflicts before creating a new version."),
        );
      }
      if (!version || !tagName || !commitMessage) {
        throw new Error(
          vscode.l10n.t(
            "Version, tag name, and commit message are all required.",
          ),
        );
      }

      // 2. changelog 插入：插在首个版本条目标题之前（顶部大标题与
      //    描述文本/注释保持在上方）；无版本条目时插在顶部标题及其后
      //    空行/HTML 注释之后；完全没有标题则顶部补一个。
      const writtenFiles: string[] = [];
      const changelogFile = findChangelogFile(repoRoot);
      if (changelogEntry.trim() && changelogFile) {
        try {
          const absPath = path.join(repoRoot, changelogFile);
          const original = fs.readFileSync(absPath, "utf-8");
          const lines = original.split("\n");
          // 版本条目标题：`#### 1.2.3` / `## [1.2.3]` / `# v1.2.3` 等
          // （容忍 v/V 前缀与方括号，用于与普通小节标题区分）
          const versionHeadingRe = /^#{1,6}\s*\[?\s*[vV]?\d+(?:\.\d+)+/;
          const firstVersionIdx = lines.findIndex((l) =>
            versionHeadingRe.test(l),
          );
          let updated: string;
          if (firstVersionIdx !== -1) {
            const before = lines
              .slice(0, firstVersionIdx)
              .join("\n")
              .trimEnd();
            const after = lines.slice(firstVersionIdx).join("\n");
            updated = `${before}\n\n#### ${version}\n${changelogEntry}\n\n${after}`;
          } else {
            const headingIdx = lines.findIndex((l) => l.startsWith("#"));
            if (headingIdx === -1) {
              updated =
                `# Changelog\n\n#### ${version}\n${changelogEntry}\n` +
                original;
            } else {
              // 顶部标题之后跳过空行与 HTML 注释（init 模板的 preamble）
              let insertIdx = headingIdx + 1;
              while (insertIdx < lines.length) {
                const trimmed = lines[insertIdx].trim();
                if (trimmed === "" || trimmed.startsWith("<!--")) {
                  insertIdx++;
                } else {
                  break;
                }
              }
              const before = lines
                .slice(0, insertIdx)
                .join("\n")
                .trimEnd();
              const after = lines.slice(insertIdx).join("\n");
              updated = after
                ? `${before}\n\n#### ${version}\n${changelogEntry}\n\n${after}`
                : `${before}\n\n#### ${version}\n${changelogEntry}\n`;
            }
          }
          fs.writeFileSync(absPath, updated, "utf-8");
          writtenFiles.push(changelogFile);
        } catch (err) {
          throw new Error(
            vscode.l10n.t(
              "New version creation aborted while updating the changelog file: {0}",
              err instanceof Error ? err.message : String(err),
            ),
          );
        }
      }

      // 3. package.json 版本号：字符串替换保留缩进与键序；不匹配才降级
      //    为整体 JSON.stringify（丢格式）。
      if (updatePackageJson) {
        try {
          const absPath = path.join(repoRoot, "package.json");
          const raw = fs.readFileSync(absPath, "utf-8");
          const versionRe = /("version"\s*:\s*")([^"]*)(")/;
          const match = versionRe.exec(raw);
          let updated: string | null = null;
          if (match) {
            // 守卫：正则可能命中嵌套的 "version" 键（如依赖块的元数据）。
            // 仅当 match 到的旧值与 JSON 顶层 version 一致时才做字符串替换
            // （保留格式）；不一致则走下方 JSON.stringify 降级路径。
            let topLevelVersion: unknown;
            try {
              topLevelVersion = (JSON.parse(raw) as { version?: unknown })
                .version;
            } catch {
              topLevelVersion = undefined;
            }
            if (
              typeof topLevelVersion === "string" &&
              topLevelVersion === match[2]
            ) {
              updated = raw.replace(
                versionRe,
                (_m, p1: string, _p2: string, p3: string) =>
                  `${p1}${version}${p3}`,
              );
            }
          }
          if (updated === null) {
            const pkg = JSON.parse(raw) as Record<string, unknown> & {
              version?: string;
            };
            pkg.version = version;
            updated = JSON.stringify(pkg, null, 2) + "\n";
          }
          fs.writeFileSync(absPath, updated, "utf-8");
          writtenFiles.push("package.json");
        } catch (err) {
          throw new Error(
            vscode.l10n.t(
              "New version creation aborted while updating package.json (changelog may already be written): {0}",
              err instanceof Error ? err.message : String(err),
            ),
          );
        }
      }

      // 4-6. 提交路径：仅版本文件（changelog / package.json）。未提交的
      // 工作区更改不属于新版本提交 —— webview 侧已提示用户确认后才走到这里。
      const commitPathList = [...writtenFiles];
      if (commitPathList.length === 0) {
        throw new Error(
          vscode.l10n.t(
            "Nothing to commit for this new version: no changelog or package.json update was made.",
          ),
        );
      }

      // git commit -- <paths> 不会带上 untracked 文件，需先 add。
      const commitPathSet = new Set(commitPathList);
      const toStage = changes
        .filter((f) => f.status === "untracked" && commitPathSet.has(f.path))
        .map((f) => f.path);
      if (toStage.length > 0) {
        try {
          await gitService.stageFiles(toStage);
        } catch (err) {
          throw new Error(
            vscode.l10n.t(
              "New version creation aborted while staging files (changelog/package.json may already be written): {0}",
              err instanceof Error ? err.message : String(err),
            ),
          );
        }
      }

      let commitHash: string;
      try {
        commitHash = await gitService.commitPaths(commitMessage, commitPathList);
      } catch (err) {
        throw new Error(
          vscode.l10n.t(
            "New version creation aborted while creating the version commit (file updates are kept in the working tree): {0}",
            err instanceof Error ? err.message : String(err),
          ),
        );
      }

      // 7. 轻量 tag（不传 message）
      try {
        await gitService.createTag(tagName, commitHash);
      } catch (err) {
        throw new Error(
          vscode.l10n.t(
            'The new version commit was created, but tagging it as "{0}" failed: {1}',
            tagName,
            err instanceof Error ? err.message : String(err),
          ),
        );
      }

      // 9. 刷新广播（照搬 stashHandlers.unstashChanges 完成后的做法）
      messageRouter.broadcastEvent("commitStateChanged", {});
      messageRouter.broadcastEvent("gitStateChanged", { scope: "all" });

      // 8. 返回
      return { commitHash, tagName, version, updatedFiles: writtenFiles };
    }),
  );

  // 推送新版本：当前分支 + tag
  messageRouter.handle(
    "pushNewVersion",
    requireGit(ctx, async (gitService, params) => {
      const tagName = params.tagName as string;
      const branch = await gitService.getCurrentBranch();
      if (!branch) {
        throw new Error(
          vscode.l10n.t(
            "Cannot push the new version: the repository has no active branch.",
          ),
        );
      }
      await gitService.push(branch, false);
      await gitService.pushTag(tagName);
      return { success: true };
    }),
  );

  // 初始化 changelog 文件
  messageRouter.handle(
    "initNewVersionChangelog",
    requireGit(ctx, async (gitService, params) => {
      const filename = (params.filename as string | undefined) ?? "";
      const language =
        (params.language as "zh" | "en" | undefined) ?? "zh";

      if (
        !filename.toLowerCase().includes("changelog") ||
        filename.includes("/") ||
        filename.includes("\\")
      ) {
        throw new Error(
          vscode.l10n.t(
            'The changelog filename must contain "changelog" and must not include path separators.',
          ),
        );
      }
      const absPath = path.join(gitService.cwd, filename);
      if (fs.existsSync(absPath)) {
        throw new Error(
          vscode.l10n.t(
            'A file named "{0}" already exists in the repository root.',
            filename,
          ),
        );
      }
      const note =
        language === "zh"
          ? "<!-- 按版本倒序记录变更 -->"
          : "<!-- Changes are listed newest first -->";
      fs.writeFileSync(absPath, `# Changelog\n${note}\n`, "utf-8");

      // 新增 untracked 文件 → 通知 commit 面板 / log 面板重扫
      // （照搬 stashHandlers.unstashChanges 的完成广播）
      messageRouter.broadcastEvent("commitStateChanged", {});
      messageRouter.broadcastEvent("gitStateChanged", { scope: "all" });
      return { changelogFile: filename };
    }),
  );

  // 更新自定义新版本提示词（空串 = 清除恢复默认）
  messageRouter.handle(
    "updateNewVersionPrompt",
    requireGit(ctx, async (gitService, params) => {
      void gitService;
      const value = (params.value as string | undefined) ?? "";
      const config = vscode.workspace.getConfiguration("projectAtlas.ai");
      // workspace 级已有取值时写 Workspace，否则 Global——固定写 Global 会被
      // 残留的 workspace 值继续遮蔽，"恢复默认"看起来不生效。
      const target =
        config.inspect("newVersionPrompt")?.workspaceValue !== undefined
          ? vscode.ConfigurationTarget.Workspace
          : vscode.ConfigurationTarget.Global;
      // update(undefined) 删除用户对该键的覆盖，回落到默认值。
      await config.update(
        "newVersionPrompt",
        value === "" ? undefined : value,
        target,
      );
      const raw = getRawNewVersionPrompt();
      return {
        effectivePrompt: getEffectiveNewVersionPrompt(raw),
        promptCustomized: raw.trim().length > 0,
      };
    }),
  );

  // 在 Git Log 面板定位某个 commit（委托给既有命令，不走 git 服务）
  messageRouter.handle("locateCommit", async (params) => {
    const hash = params.hash as string;
    await vscode.commands.executeCommand(
      "git-atlas.locateCommit",
      hash,
      ctx.registry.getCurrentRepoPath(),
    );
    return { success: true };
  });
}
