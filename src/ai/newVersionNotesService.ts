import type { AiChatConfig } from "./aiClient";
import { chat } from "./aiClient";

/**
 * 新版本（New Version）changelog 生成服务：内置默认提示词、提示词/消息
 * 构造、版本号 bump 建议，以及基于共享 aiClient 的生成入口。
 */

export const DEFAULT_NEW_VERSION_PROMPT = `You are a release changelog writer. Based on the commits and
uncommitted file changes since the last release, write the
changelog entry for the new version.

Group changes by category, in this order, using bold headings
followed by \`-\` list items (one line per change). Only categories
that have at least one entry may appear:

**New Features** — new capabilities (feat)
**Bug Fixes** — bug fixes (fix)
**Improvements** — refactoring, performance, and UI polish
**Others** — notable changes that fit no category above

Rules:
- {{language}}
- Never output a heading for an empty category: if a category has
  no entries, omit both the heading and its list entirely — no
  empty sections and no placeholder lines like "None".
- When a changelog excerpt is provided, follow its grouping style:
  if it groups entries under category headings, reuse those heading
  names and their order; if it uses a flat layout with no headings,
  apply the four categories above instead. In both cases borrow its
  entry-line phrasing (e.g. a bold scope prefix like \`- **Scope**: ...\`).
- Cover features, bug fixes, UI changes, and performance
  improvements. Skip chores, CI, docs-only, test-only, and
  config-only changes.
- Describe changes from the user's perspective; do not mention
  commit hashes or internal file paths.
- Do not output a version heading or date line — only the entry
  body is wanted.
- Output plain text only. No explanations, no code fences.`;

/** 生成新版本 changelog 所需的输入数据。 */
export interface NewVersionChangelogInput {
  commits: { hash: string; subject: string; author: string; shortDate: string }[];
  fileChanges: { path: string; status: string }[];
  changelogExcerpt?: string;
}

/** 配置值 trim 后为空则回退内置默认提示词。 */
export function getEffectiveNewVersionPrompt(configValue: string): string {
  const trimmed = configValue.trim();
  return trimmed ? trimmed : DEFAULT_NEW_VERSION_PROMPT;
}

/**
 * 构造 system/user 两条消息。
 *
 * system：将 prompt 中的 {{language}} 占位符替换为语言指令；prompt 不含
 * 该占位符时在末尾追加语言指令行。
 * user：固定三段——commits、未提交文件变更（非空时）、changelog 风格参考（非空时，截前 40 行）。
 */
export function buildNewVersionMessages(
  input: NewVersionChangelogInput,
  language: "zh" | "en",
  prompt: string,
): { system: string; user: string } {
  const langName = language === "zh" ? "Chinese (中文)" : "English";
  const langInstruction =
    language === "zh"
      ? `Write the changelog in ${langName}, with category headings only for categories that have entries (e.g. 新功能 / Bug 修复 / 改进 / 其他); never output a heading for an empty category. The output language is mandatory and overrides the language of any provided changelog excerpt.`
      : `Write the changelog in ${langName}, with category headings only for categories that have entries; never output a heading for an empty category. The output language is mandatory and overrides the language of any provided changelog excerpt.`;

  let system: string;
  if (prompt.includes("{{language}}")) {
    system = prompt.split("{{language}}").join(langInstruction);
  } else {
    system = `${prompt}\n${langInstruction}`;
  }

  const sections: string[] = [];

  if (input.commits.length > 0) {
    sections.push(
      [
        "Commits since last release:",
        ...input.commits.map((c) => `- ${c.subject} (${c.author}, ${c.shortDate})`),
      ].join("\n"),
    );
  }

  if (input.fileChanges.length > 0) {
    sections.push(
      [
        "Uncommitted changes to include:",
        ...input.fileChanges.map((f) => `- ${f.status} ${f.path}`),
      ].join("\n"),
    );
  }

  if (input.changelogExcerpt) {
    sections.push(
      [
        "Existing changelog top (structure and entry-style reference only — ignore its language, write in the language required above):",
        ...input.changelogExcerpt.split("\n").slice(0, 40),
      ].join("\n"),
    );
  }

  return { system, user: sections.join("\n\n") };
}

/**
 * 根据 commit subjects 建议版本号 bump 级别。
 *
 * - 任一 subject 以 `type!:` 形式开头（`^[\w-]+!`，如 `feat!:`）或以
 *   "BREAKING CHANGE" 开头（按规范大写，区分大小写）→ major
 * - 否则任一以 feat/feature 前缀（`feat:`、`feat(scope):`）→ minor
 * - 否则 patch
 */
export function suggestBump(subjects: string[]): "major" | "minor" | "patch" {
  const featRe = /^(feat|feature)(\([^)]*\))?:/i;

  for (const subject of subjects) {
    if (/^[\w-]+!/.test(subject) || subject.startsWith("BREAKING CHANGE")) {
      return "major";
    }
  }
  for (const subject of subjects) {
    if (featRe.test(subject)) return "minor";
  }
  return "patch";
}

/** 调用共享 AI 客户端生成新版本 changelog，并清理模型输出。 */
export async function generateNewVersionChangelog(
  cfg: AiChatConfig,
  input: NewVersionChangelogInput,
  language: "zh" | "en",
  prompt: string,
  cancelSignal: AbortSignal,
): Promise<string> {
  const { system, user } = buildNewVersionMessages(input, language, prompt);
  // changelog 远长于 commit message，覆盖默认 500 token 截断上限。
  const response = await chat(
    { ...cfg, maxTokens: cfg.maxTokens ?? 2000 },
    system,
    user,
    cancelSignal,
  );
  return stripEmptyCategoryHeadings(cleanChangelog(response));
}

/**
 * 兜底清理：剔除没有任何条目的分组标题行。
 *
 * 处理两类残留（即使提示词已要求省略空分组，模型仍可能输出）：
 * - 加粗标题：`**新功能**`、`**Bug Fixes**` 等独立成行，其后直到下一个
 *   标题/非列表内容之间没有 `- ` 列表项；
 * - Markdown 标题：`## 新功能`、`### Bug Fixes` 同理。
 *
 * 判定规则：某标题行之后、到下一个同级或更高级标题之前，若不存在任何
 * `\`-\` 列表项行，则该标题（及其紧邻的空行）被视为空分组而移除。
 * 已有条目的分组不受影响；连续多个空分组标题一并移除。
 */
function stripEmptyCategoryHeadings(text: string): string {
  const lines = text.split("\n");
  const headingRe = /^\s*(?:\*\*(.+?)\*\*|#{1,6}\s+(.+?))\s*:?\s*$/;
  const listItemRe = /^\s*[-*]\s+/;

  const isHeading = (line: string) => headingRe.test(line);

  const kept: string[] = [];
  let i = 0;
  while (i < lines.length) {
    if (!isHeading(lines[i])) {
      kept.push(lines[i]);
      i++;
      continue;
    }
    // 收集从当前标题开始、由连续标题+非列表内容构成的块，
    // 直到遇到首个列表项（有内容）或下一个"带内容的标题"为止。
    const block: string[] = [];
    let hasItems = false;
    let j = i;
    while (j < lines.length) {
      const line = lines[j];
      if (listItemRe.test(line)) {
        hasItems = true;
        break;
      }
      if (isHeading(line) && block.length > 0) {
        // 连续标题：先停下，外层会逐个评估。
        break;
      }
      if (isHeading(line) && block.length === 0) {
        block.push(line);
        j++;
        continue;
      }
      // 非列表、非标题的普通行（如说明文字）归属当前分组
      block.push(line);
      j++;
    }
    if (hasItems) {
      kept.push(...lines.slice(i, j));
      i = j;
    } else {
      // 空分组：跳过标题及其后连续空行
      let k = j;
      while (k < lines.length && lines[k].trim() === "") {
        k++;
      }
      i = k;
    }
  }

  // 移除因剔除产生的首尾多余空行
  const result = kept.join("\n").replace(/^\n+/, "").replace(/\n+$/, "");
  return result;
}

/** 剥代码围栏与首尾引号（与 AiCommitService.cleanMessage 逻辑一致）。 */
function cleanChangelog(raw: string): string {
  // Strip code fences if the model wrapped output despite instructions
  let msg = raw.trim();
  if (msg.startsWith("```")) {
    msg = msg.replace(/^```[a-z]*\n?/, "").replace(/```\s*$/, "");
  }
  // Strip leading/trailing quotes
  msg = msg.replace(/^["'`]+|["'`]+$/g, "");
  return msg.trim();
}
