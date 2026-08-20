import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import type { GitHandlerContext } from "../gitContext";
import { requireGit } from "../gitContext";
import {
  checkGhAuth,
  checkGhInstalled,
  clearGiteeToken,
  createGhRelease,
  createGiteeRelease,
  getGiteeToken,
  parseRemoteUrl,
  setGiteeToken,
  uploadGiteeAttachment,
} from "../../git/remoteReleaseService";
import type { ReleasePlatform } from "../../git/remoteReleaseService";
import type { ParsedRemote } from "../../git/remoteReleaseService";
import {
  findChangelogFile,
  VERSION_HEADING_RE_SOURCE,
} from "./newVersionHandlers";

interface RemoteReleaseTarget {
  platform: ReleasePlatform;
  remoteName: string;
  owner: string;
  repo: string;
  configured: boolean;
  authOk: boolean;
  authHint?: string;
}

/**
 * Release（发布）handlers — commit 面板 release tab 的后端。
 *
 * 依赖：
 * - remoteReleaseService（gh CLI 封装 + Gitee API + remote URL 解析 + token）
 * - gitService.getRemotes / getBranches / getTags / createTag / pushTag
 *   （仓库根 = gitService.cwd，gitService 为 getter，跟随当前 repo 切换）
 * - newVersionHandlers.findChangelogFile（changelog 文件定位，两 tab 共用）
 *
 * 协议契约（与 webview 端共享，命令名/结构不可改动）：
 * - getRemoteReleaseTargets { } → { targets, branches, tags }
 * - createRelease { targets, tagName, isNewTag, title, notes, targetBranch,
 *   prerelease, draft, attachments } → { results }（每平台独立成败）
 * - getChangelogEntryForTag { tagName } → { notes }（无匹配返回空串，不报错）
 * - selectReleaseAttachments { } → { attachments: [{ path, size }] }
 */

interface ReleaseTargetParam {
  platform: "github" | "gitee";
  remoteName: string;
}

/**
 * 在 changelog 内容中找版本号为 `version`（已去 v/V 前缀）的标题行，
 * 返回该标题行的行尾位置（条目正文从下一行开始）；未命中返回 -1。
 *
 * 边界语义：
 * - 逐行扫描候选版本标题（VERSION_HEADING_RE_SOURCE，捕获组比对版本号），
 *   跳过版本号不匹配的行，命中目标行后返回**该行行尾**而非版本号末尾 ——
 *   `## [1.2.3] - 2024-01-01` 这类带日期后缀的标题行，若从版本号末尾截取
 *   会把 `] - 2024-01-01` 当作条目前缀。
 */
function findVersionHeadingIndex(content: string, version: string): number {
  const re = new RegExp(VERSION_HEADING_RE_SOURCE, "gm");
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    if (m[1] === version) {
      const nl = content.indexOf("\n", m.index);
      return nl === -1 ? content.length : nl;
    }
  }
  return -1;
}

/**
 * 提取标题行行尾到下一个**版本标题**之前的条目正文（trim）。
 *
 * 结束边界用 VERSION_HEADING_RE_SOURCE（版本标题）而非任意 markdown 标题：
 * Keep a Changelog 风格条目内的 `### Added` / `### Fixed` 子标题属于条目
 * 正文，按任意 `#` 标题截断会把正文全部截掉。
 */
function extractEntryAfter(content: string, headingEnd: number): string {
  const after = content.slice(headingEnd);
  const m = new RegExp(VERSION_HEADING_RE_SOURCE, "m").exec(after);
  const entry = m ? after.slice(0, m.index) : after;
  return entry.trim();
}

/**
 * 弹出 Gitee token 输入框并存入 SecretStorage。
 * 返回存储后是否已配置（用户取消 / 输入空串 → false）。
 * git-atlas.setGiteeToken 命令与 promptGiteeToken 协议命令共用。
 */
async function promptAndSaveGiteeToken(
  ctx: GitHandlerContext,
): Promise<boolean> {
  const token = await vscode.window.showInputBox({
    prompt: vscode.l10n.t("Enter your Gitee personal access token"),
    password: true,
    ignoreFocusOut: true,
  });
  if (token === undefined) {
    return false; // 用户取消
  }
  const trimmed = token.trim();
  if (!trimmed) {
    // 空串视为无效输入：不写 SecretStorage、不弹"已保存"提示
    //（清除 token 有专门的 git-atlas.clearGiteeToken 命令）
    return false;
  }
  await setGiteeToken(ctx.context, trimmed);
  void vscode.window.showInformationMessage(
    vscode.l10n.t("Gitee token saved."),
  );
  return true;
}

export function registerReleaseHandlers(ctx: GitHandlerContext): void {
  const { messageRouter } = ctx;

  // 发布 tab 首屏：remote 平台扫描 + 分支列表 + tag 列表
  messageRouter.handle(
    "getRemoteReleaseTargets",
    requireGit(ctx, async (gitService) => {
      const remotes = await gitService.getRemotes();

      // gh 检查对所有 github remote 共享一次（避免同平台多 remote 重复执行）
      const hasGithub = remotes.some(
        (r) => parseRemoteUrl(r.url)?.platform === "github",
      );
      let ghInstalled = false;
      let ghAuth: { ok: boolean; hint?: string } = { ok: false };
      if (hasGithub) {
        ghInstalled = await checkGhInstalled();
        ghAuth = ghInstalled ? await checkGhAuth() : { ok: false };
      }

      const giteeToken = await getGiteeToken(ctx.context);

      const targets: RemoteReleaseTarget[] = [];
      for (const { name, url } of remotes) {
        const parsed = parseRemoteUrl(url);
        if (!parsed) {
          continue; // 其他 host 忽略
        }
        if (parsed.platform === "github") {
          if (!ghInstalled) {
            targets.push({
              platform: "github" as const,
              remoteName: name,
              owner: parsed.owner,
              repo: parsed.repo,
              configured: false,
              authOk: false,
              authHint: vscode.l10n.t(
                "GitHub CLI (gh) is not installed. Install it from https://cli.github.com/",
              ),
            });
          } else {
            targets.push({
              platform: "github" as const,
              remoteName: name,
              owner: parsed.owner,
              repo: parsed.repo,
              configured: true,
              authOk: ghAuth.ok,
              authHint: ghAuth.ok
                ? undefined
                : ghAuth.hint ||
                  vscode.l10n.t("Run gh auth login to authenticate with GitHub."),
            });
          }
        } else {
          const configured = !!giteeToken;
          targets.push({
            platform: "gitee" as const,
            remoteName: name,
            owner: parsed.owner,
            repo: parsed.repo,
            configured,
            authOk: configured,
            authHint: configured
              ? undefined
              : vscode.l10n.t(
                  'Set a Gitee token via "Git Atlas: Set Gitee Token".',
                ),
          });
        }
      }

      // 本地分支：当前分支最前，其次 main/master（默认分支），其余按字母序
      const allBranches = await gitService.getBranches();
      const currentBranch = allBranches.find(
        (b) => !b.isRemote && b.isCurrent,
      )?.name;
      const branchNames = allBranches
        .filter((b) => !b.isRemote && b.name)
        .map((b) => b.name);
      const branchScore = (n: string): number =>
        n === currentBranch ? 0 : n === "main" || n === "master" ? 1 : 2;
      branchNames.sort((a, b) => {
        const d = branchScore(a) - branchScore(b);
        return d !== 0
          ? d
          : a.localeCompare(b, undefined, { sensitivity: "base" });
      });

      // tag：getTags 已按 creatordate 倒序（新在前）
      const tags = (await gitService.getTags()).map((t) => t.name);

      return { targets, branches: branchNames, tags };
    }),
  );

  // 发布到远程平台：每平台独立 try/catch，单平台失败不影响其他
  messageRouter.handle(
    "createRelease",
    requireGit(ctx, async (gitService, params) => {
      const targets = (params.targets as ReleaseTargetParam[] | undefined) ?? [];
      const tagName = ((params.tagName as string | undefined) ?? "").trim();
      const isNewTag = !!(params.isNewTag as boolean | undefined);
      const title = ((params.title as string | undefined) ?? "").trim();
      const notes = (params.notes as string | undefined) ?? "";
      const targetBranch =
        ((params.targetBranch as string | undefined) ?? "").trim();
      const prerelease = !!(params.prerelease as boolean | undefined);
      const draft = !!(params.draft as boolean | undefined);
      const attachments =
        (params.attachments as string[] | undefined) ?? [];

      if (!tagName) {
        throw new Error(vscode.l10n.t("Tag name is required."));
      }
      if (!targetBranch) {
        throw new Error(vscode.l10n.t("Target branch is required."));
      }
      if (targets.length === 0) {
        throw new Error(vscode.l10n.t("At least one release target is required."));
      }

      // 新 tag：在目标分支最新 commit 上创建本地轻量 tag（不依赖平台自动建 tag，
      // 保证 GitHub/Gitee 两平台路径一致）
      if (isNewTag) {
        try {
          await gitService.createTag(tagName, targetBranch);
        } catch (err) {
          throw new Error(
            vscode.l10n.t(
              'Creating tag "{0}" failed: {1}',
              tagName,
              err instanceof Error ? err.message : String(err),
            ),
          );
        }
      }

      const remotes = await gitService.getRemotes();
      // 空标题回退为 tag 名（gh/Gitee 均拒绝空 release 标题；webview 默认
      // 填 v{version}，这里兜底手动清空的用户输入）
      const effectiveTitle = title || tagName;

      const results: Array<{
        platform: string;
        remoteName: string;
        success: boolean;
        url?: string;
        error?: string;
      }> = [];

      for (const target of targets) {
        // 提升到 try 外：catch 分支的结果行也要用后端解析出的 platform
        //（与流程分支一致；remote 解析本身失败时回退 target.platform）
        let parsed: ParsedRemote | null = null;
        try {
          const remoteUrl = remotes.find(
            (r) => r.name === target.remoteName,
          )?.url;
          parsed = remoteUrl ? parseRemoteUrl(remoteUrl) : null;
          if (!parsed) {
            throw new Error(
              vscode.l10n.t(
                'Remote "{0}" was not found or is not a GitHub/Gitee remote.',
                target.remoteName,
              ),
            );
          }

          // 确保 tag 已到达该平台（remote 名不一定是 origin，按平台对应 remote 推送）；
          // 远端已有同名 tag 的推送失败按成功对待（幂等）
          try {
            await gitService.pushTag(tagName, target.remoteName);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (!/already exists/i.test(msg)) {
              throw new Error(
                vscode.l10n.t(
                  'Pushing tag "{0}" to remote "{1}" failed: {2}',
                  tagName,
                  target.remoteName,
                  msg,
                ),
              );
            }
          }

          let url: string | undefined;
          if (parsed.platform === "github") {
            const gh = await createGhRelease({
              cwd: gitService.cwd,
              owner: parsed.owner,
              repo: parsed.repo,
              tagName,
              title: effectiveTitle,
              notes,
              targetBranch,
              prerelease,
              draft,
              attachments,
            });
            url = gh.url;
          } else {
            const token = await getGiteeToken(ctx.context);
            if (!token) {
              throw new Error(
                vscode.l10n.t(
                  'Gitee token is not set. Run "Git Atlas: Set Gitee Token" first.',
                ),
              );
            }
            const release = await createGiteeRelease({
              token,
              owner: parsed.owner,
              repo: parsed.repo,
              tagName,
              title: effectiveTitle,
              notes,
              targetBranch,
              prerelease,
            });
            for (const file of attachments) {
              try {
                await uploadGiteeAttachment({
                  token,
                  owner: parsed.owner,
                  repo: parsed.repo,
                  releaseId: release.id,
                  filePath: file,
                });
              } catch (err) {
                throw new Error(
                  vscode.l10n.t(
                    'Uploading attachment "{0}" failed: {1}',
                    path.basename(file),
                    err instanceof Error ? err.message : String(err),
                  ),
                );
              }
            }
            url = release.url || undefined;
          }

          results.push({
            platform: parsed.platform,
            remoteName: target.remoteName,
            success: true,
            url,
          });
        } catch (err) {
          results.push({
            platform: parsed?.platform ?? target.platform,
            remoteName: target.remoteName,
            success: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      if (isNewTag) {
        messageRouter.broadcastEvent("gitStateChanged", { scope: "all" });
      }

      return { results };
    }),
  );

  // 读取某 tag 对应版本的 changelog 条目（无文件/无匹配返回空串，不报错）
  messageRouter.handle(
    "getChangelogEntryForTag",
    requireGit(ctx, async (gitService, params) => {
      const tagName = ((params.tagName as string | undefined) ?? "").trim();
      const changelogFile = findChangelogFile(gitService.cwd);
      if (!tagName || !changelogFile) {
        return { notes: "" };
      }
      let content: string;
      try {
        content = fs.readFileSync(
          path.join(gitService.cwd, changelogFile),
          "utf-8",
        );
      } catch {
        return { notes: "" };
      }
      // tagName 去 v/V 前缀后与标题中的版本号比对（`#### 1.2.3` /
      // `## [1.2.3]` / `# v1.2.3` 等格式均可命中）
      const version = tagName.replace(/^[vV]/, "");
      if (!/^\d+(?:\.\d+)+/.test(version)) {
        return { notes: "" };
      }
      const headingEnd = findVersionHeadingIndex(content, version);
      if (headingEnd === -1) {
        return { notes: "" };
      }
      return { notes: extractEntryAfter(content, headingEnd) };
    }),
  );

  // 附件选择（系统文件多选对话框，不限制扩展名）
  messageRouter.handle("selectReleaseAttachments", async () => {
    const uris = await vscode.window.showOpenDialog({
      canSelectMany: true,
      title: vscode.l10n.t("Select release attachments"),
    });
    if (!uris || uris.length === 0) {
      return { attachments: [] };
    }
    const attachments = uris.map((uri) => {
      let size = 0;
      try {
        size = fs.statSync(uri.fsPath).size;
      } catch {
        // stat 失败按 0 字节返回，发布时再暴露真实错误
      }
      return { path: uri.fsPath, size };
    });
    return { attachments };
  });

  // webview 请求弹出 Gitee token 输入框（与 git-atlas.setGiteeToken 命令同逻辑）
  messageRouter.handle("promptGiteeToken", async () => {
    return { configured: await promptAndSaveGiteeToken(ctx) };
  });

  // ─── Gitee token 设置/清除（VSCode 命令，SecretStorage） ──────────

  ctx.context.subscriptions.push(
    vscode.commands.registerCommand("git-atlas.setGiteeToken", async () => {
      await promptAndSaveGiteeToken(ctx);
    }),
    vscode.commands.registerCommand("git-atlas.clearGiteeToken", async () => {
      await clearGiteeToken(ctx.context);
      void vscode.window.showInformationMessage(
        vscode.l10n.t("Gitee token cleared."),
      );
    }),
  );
}
