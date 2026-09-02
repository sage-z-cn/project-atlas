import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import * as vscode from "vscode";

const execFileAsync = promisify(execFile);

/** Gitee Personal Access Token 的 SecretStorage 键（非 package.json configuration）。 */
export const GITEE_TOKEN_SECRET_KEY = "projectAtlas.git.giteeToken";

/**
 * Gitee 单附件上限校验阈值。社区实测上限为 100MB（官方 API 未标注）。
 */
const GITEE_ATTACHMENT_MAX_BYTES = 100 * 1024 * 1024;

/**
 * Gitee API 超时：创建 Release 3 分钟 / 附件上传 5 分钟（大附件，与前端
 * bridge 的 600s 请求预算协调）。AbortSignal.timeout 需 Node 17.3+，
 * 扩展宿主（Node 18+，全局 fetch 同源）可用。
 */
const GITEE_RELEASE_TIMEOUT_MS = 3 * 60_000;
const GITEE_UPLOAD_TIMEOUT_MS = 5 * 60_000;

/** gh CLI 子进程超时，避免挂起的 CLI 卡死发布流程。 */
const GH_TIMEOUT_MS = 60_000;
const GH_VERSION_TIMEOUT_MS = 10_000;
/**
 * gh release create 带附件时的放宽超时：附件作为位置参数由同一条命令上传，
 * 大附件在普通上行带宽下轻松超过 60s——被杀时 release 通常已在服务端创建、
 * 资产只传一半，重试会撞 "release already exists"。取 9 分钟（而非 10）：
 * 前端 bridge 的 600s 请求预算先到期，扩展侧超时必须短于它，避免 bridge
 * 已把请求标记失败而 gh 子进程仍在传输。
 */
const GH_RELEASE_WITH_ASSETS_TIMEOUT_MS = 9 * 60_000;

export type ReleasePlatform = "github" | "gitee";

export interface ParsedRemote {
  platform: ReleasePlatform;
  owner: string;
  repo: string;
}

// ─── Remote URL 解析 ────────────────────────────────────────────────

/**
 * 解析 remote URL → { platform, owner, repo }。
 *
 * 支持的形式：
 * - `git@github.com:owner/repo.git`（SSH scp 语法）
 * - `https://github.com/owner/repo.git`（含 http:// 与 userinfo：
 *   `https://oauth2:TOKEN@github.com/...` / `https://user@github.com/...`，
 *   经 new URL 剥离 userinfo 后取 hostname）
 * - `ssh://git@github.com/owner/repo.git`（标准 SSH URL，含
 *   `ssh://git@host:port/owner/repo.git` 端口形式）
 *
 * host 仅识别 github.com / gitee.com（不区分大小写），其余平台返回 null
 * （调用方按"不支持的平台"忽略）。repo 一律去掉结尾 `.git` 与 `/`。
 */
export function parseRemoteUrl(url: string): ParsedRemote | null {
  const s = url.trim();

  // scp 语法（git@host:owner/repo）不走 URL 解析——冒号分隔符不是合法 URL 结构
  const scpMatch = /^git@([^:/]+):([^/]+)\/([^/]+)$/.exec(s);
  if (scpMatch) {
    const repo = scpMatch[3].endsWith(".git")
      ? scpMatch[3].slice(0, -4)
      : scpMatch[3];
    return resolvePlatform(scpMatch[1], scpMatch[2], repo);
  }

  // https?:// 与 ssh:// 统一经 new URL：userinfo 自动剥离，hostname 不含端口
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:" && u.protocol !== "ssh:") {
    return null;
  }
  let p = u.pathname.replace(/^\/+/, "");
  p = p.endsWith("/") ? p.slice(0, -1) : p;
  p = p.endsWith(".git") ? p.slice(0, -4) : p;
  const parts = p.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return null;
  }
  return resolvePlatform(u.hostname, parts[0], parts[1]);
}

function resolvePlatform(
  host: string,
  owner: string,
  repo: string,
): ParsedRemote | null {
  const normalizedHost = host.toLowerCase();
  if (normalizedHost === "github.com") {
    return { platform: "github", owner, repo };
  }
  if (normalizedHost === "gitee.com") {
    return { platform: "gitee", owner, repo };
  }
  return null;
}

// ─── gh CLI（GitHub） ───────────────────────────────────────────────

/**
 * gh CLI 是否已安装（`gh --version` 退出码 0）。
 * 与 gitService.execGit 相同的 env 约定（LC_ALL=C 等）；gh.exe 在 Windows
 * 上由 execFile 经 PATH 解析，与 git 相同，无需特殊处理。
 */
export async function checkGhInstalled(): Promise<boolean> {
  try {
    await execFileAsync("gh", ["--version"], {
      timeout: GH_VERSION_TIMEOUT_MS,
      env: { ...process.env, LC_ALL: "C" },
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * gh 是否已认证（`gh auth status` 退出码 0 = 已认证）。
 *
 * 注意：不要加 `--json` —— 认证失败时它会把真实错误掩盖成解析失败。
 * 未认证时把 stderr（截断）作为引导信息返回（gh 的 stderr 通常自带
 * "Run gh auth login" 提示）。
 */
export async function checkGhAuth(): Promise<{ ok: boolean; hint?: string }> {
  try {
    await execFileAsync("gh", ["auth", "status"], {
      timeout: GH_TIMEOUT_MS,
      env: { ...process.env, LC_ALL: "C" },
    });
    return { ok: true };
  } catch (err) {
    const stderr = extractProcessError(err);
    return { ok: false, hint: stderr ? truncate(stderr, 300) : undefined };
  }
}

export interface CreateGhReleaseParams {
  cwd: string;
  owner: string;
  repo: string;
  tagName: string;
  title: string;
  notes: string;
  targetBranch: string;
  prerelease: boolean;
  draft: boolean;
  /** 附件文件绝对路径列表，gh 一次命令全部上传。 */
  attachments: string[];
}

/**
 * `gh release create <tag> -R <owner>/<repo> --title --notes-file --target
 * [--prerelease] [--draft] <files...>`。
 *
 * - 必须显式 `-R`：非交互下 gh 按 upstream > github > origin > 字母序自动
 *   选 remote，多 GitHub remote 时会静默发到错误仓库。
 * - 长 Notes 写临时文件走 `--notes-file`，规避 Windows 命令行参数长度限制。
 * - stdout 末行的 URL 作为结果 url。
 */
export async function createGhRelease(
  p: CreateGhReleaseParams,
): Promise<{ url?: string }> {
  const notesFile = path.join(
    os.tmpdir(),
    `atlas-release-notes-${Date.now()}-${Math.random().toString(36).slice(2)}.md`,
  );
  fs.writeFileSync(notesFile, p.notes, "utf-8");
  try {
    const args = [
      "release",
      "create",
      p.tagName,
      "-R",
      `${p.owner}/${p.repo}`,
      "--title",
      p.title,
      "--notes-file",
      notesFile,
      "--target",
      p.targetBranch,
    ];
    if (p.prerelease) {
      args.push("--prerelease");
    }
    if (p.draft) {
      args.push("--draft");
    }
    for (const file of p.attachments) {
      args.push(file);
    }
    const { stdout } = await execFileAsync("gh", args, {
      cwd: p.cwd,
      // 附件由同一命令上传：分级超时（无附件 60s；有附件放宽，见常量注释）
      timeout:
        p.attachments.length > 0
          ? GH_RELEASE_WITH_ASSETS_TIMEOUT_MS
          : GH_TIMEOUT_MS,
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env, LC_ALL: "C" },
    });
    const url = lastUrlFromOutput(stdout);
    return url ? { url } : {};
  } catch (err) {
    throw new Error(
      vscode.l10n.t(
        "GitHub release creation failed: {0}",
        extractProcessError(err) || String(err),
      ),
    );
  } finally {
    try {
      fs.unlinkSync(notesFile);
    } catch {
      // 临时文件清理失败可忽略
    }
  }
}

/** 从进程输出中取最后一行 http(s) URL（gh release create 成功时输出 Release 链接）。 */
function lastUrlFromOutput(stdout: string): string | undefined {
  const lines = stdout.trim().split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]?.trim();
    if (line && /^https?:\/\//.test(line)) {
      return line;
    }
  }
  return undefined;
}

// ─── Gitee API（Node 18 全局 fetch） ────────────────────────────────

export interface CreateGiteeReleaseParams {
  token: string;
  owner: string;
  repo: string;
  tagName: string;
  title: string;
  notes: string;
  targetBranch: string;
  prerelease: boolean;
}

/**
 * `POST https://gitee.com/api/v5/repos/{owner}/{repo}/releases`。
 * `target_commitish` 在 OpenAPI 规范中为必填（分支名或 SHA），无论 tag 是否
 * 已存在都传入 targetBranch。Gitee 无 Draft 概念，草稿仅对 GitHub 生效。
 */
export async function createGiteeRelease(
  p: CreateGiteeReleaseParams,
): Promise<{ id: number; url: string }> {
  let res: Response;
  try {
    res = await fetch(
      `https://gitee.com/api/v5/repos/${encodeURIComponent(p.owner)}/${encodeURIComponent(p.repo)}/releases`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          access_token: p.token,
          tag_name: p.tagName,
          name: p.title,
          body: p.notes,
          prerelease: p.prerelease,
          target_commitish: p.targetBranch,
        }),
        signal: AbortSignal.timeout(GITEE_RELEASE_TIMEOUT_MS),
      },
    );
  } catch (err) {
    throw new Error(
      vscode.l10n.t(
        "Gitee release request failed: {0}",
        err instanceof Error ? err.message : String(err),
      ),
    );
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      vscode.l10n.t(
        "Gitee release creation failed ({0}): {1}",
        String(res.status),
        truncate(text, 300),
      ),
    );
  }
  const json = (await res.json().catch(() => ({}))) as {
    id?: number;
    html_url?: string;
  };
  return { id: json.id ?? 0, url: json.html_url ?? "" };
}

/**
 * `POST .../releases/{releaseId}/attach_files`，multipart 字段名 `file`。
 *
 * 上传前校验单文件大小 ≤ 100MB（Gitee 实测上限），超限直接
 * 报错（含文件名与大小），不发起请求。token 走 URL query 参数（multipart
 * body 中无法混入表单字段以外的认证参数）。
 */
export async function uploadGiteeAttachment(params: {
  token: string;
  owner: string;
  repo: string;
  releaseId: number | string;
  filePath: string;
}): Promise<void> {
  const stat = fs.statSync(params.filePath);
  if (stat.size > GITEE_ATTACHMENT_MAX_BYTES) {
    throw new Error(
      vscode.l10n.t(
        'Attachment "{0}" is {1} MB, larger than the Gitee per-file limit (100 MB).',
        path.basename(params.filePath),
        (stat.size / (1024 * 1024)).toFixed(1),
      ),
    );
  }

  const form = new FormData();
  const data = fs.readFileSync(params.filePath);
  form.append(
    "file",
    new Blob([new Uint8Array(data)]),
    path.basename(params.filePath),
  );

  let res: Response;
  try {
    res = await fetch(
      `https://gitee.com/api/v5/repos/${encodeURIComponent(params.owner)}/${encodeURIComponent(params.repo)}/releases/${encodeURIComponent(String(params.releaseId))}/attach_files?access_token=${encodeURIComponent(params.token)}`,
      { method: "POST", body: form, signal: AbortSignal.timeout(GITEE_UPLOAD_TIMEOUT_MS) },
    );
  } catch (err) {
    throw new Error(
      vscode.l10n.t(
        "Gitee attachment upload request failed: {0}",
        err instanceof Error ? err.message : String(err),
      ),
    );
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      vscode.l10n.t(
        "Gitee attachment upload failed ({0}): {1}",
        String(res.status),
        truncate(text, 300),
      ),
    );
  }
}

// ─── Gitee token（SecretStorage） ───────────────────────────────────

export async function getGiteeToken(
  context: vscode.ExtensionContext,
): Promise<string | undefined> {
  return context.secrets.get(GITEE_TOKEN_SECRET_KEY);
}

export async function setGiteeToken(
  context: vscode.ExtensionContext,
  token: string,
): Promise<void> {
  await context.secrets.store(GITEE_TOKEN_SECRET_KEY, token);
}

export async function clearGiteeToken(
  context: vscode.ExtensionContext,
): Promise<void> {
  await context.secrets.delete(GITEE_TOKEN_SECRET_KEY);
}

// ─── 内部工具 ───────────────────────────────────────────────────────

/** execFile 错误 → 可读文本：优先 stderr，其次 message。 */
function extractProcessError(err: unknown): string {
  const e = err as { stderr?: string | Buffer; message?: string };
  if (e?.stderr) {
    const s = e.stderr.toString().trim();
    if (s) {
      return s;
    }
  }
  return e?.message ?? String(err);
}

function truncate(s: string, max: number): string {
  const t = s.trim();
  return t.length <= max ? t : `${t.slice(0, max)}...`;
}
