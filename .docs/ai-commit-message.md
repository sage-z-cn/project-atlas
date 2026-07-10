# AI 自动生成 Commit Message

> 功能设计文档 · Git Atlas 子系统

## 概述

在 Git Atlas 提交面板的 commit message 输入框旁增加一个按钮，点击后调用用户配置的 AI API，根据当前改动自动生成 commit message。

## 功能需求

### 按钮位置

`CommitMessageArea` 组件中的 `.commit-amend-row`（即 Amend 复选框 + 历史按钮所在行），在历史按钮旁新增一个 AI 生成按钮。

### 生成策略（取决于列表风格）

| 列表风格 | 优先来源 | 回退来源 |
|---------|---------|---------|
| VSCode | 暂存区的改动（`git diff --cached`） | 所有改动（staged + unstaged + untracked） |
| JetBrains | 勾选的文件 | 所有改动 |

> "所有改动" = tracked 文件的 `git diff HEAD` + untracked 文件内容拼合。

### 按钮禁用条件

按钮在以下任一情况禁用：

1. 没有任何改动（`changes.length === 0`）
2. AI 未配置（缺少 API URL 或 API Key）
3. 正在生成中（loading 状态）

### 配置项

新增 `gitAtlas.aiCommit.*` 配置组：

| 配置键 | 类型 | 默认值 | 说明 |
|-------|------|--------|------|
| `gitAtlas.aiCommit.apiUrl` | string | `""` | OpenAI 兼容的 Chat Completions API 地址，如 `https://api.openai.com/v1/chat/completions` |
| `gitAtlas.aiCommit.model` | string | `""` | 模型名称，如 `gpt-4o-mini`、`deepseek-chat` |
| `gitAtlas.aiCommit.language` | string | `"auto"` | commit message 语言，`"en"`（英文）/ `"zh"`（中文）/ `"follow-locale"`（跟随 VSCode 显示语言）/ `"auto"`（根据 git 历史自动检测，默认） |
| `gitAtlas.aiCommit.maxDiffChars` | number | `8000` | 发送给 AI 的最大 diff 字符数，超出截断 |

**配置作用域**：`apiUrl` / `model` / `language` / `maxDiffChars` 均支持**项目级覆盖**。VSCode 配置天然按 Workspace Folder → Workspace → Global 逐级覆盖，无需额外编码——`vscode.workspace.getConfiguration("gitAtlas.aiCommit")` 读取时自动取最终生效值。用户可在 `.vscode/settings.json` 中为不同项目配置不同的 API 地址/模型/语言。

**API Key 不放在 settings.json**（明文不安全），使用 VSCode SecretStorage（全局存储，跨项目共享）：
- 新增命令 `git-atlas.setAiApiKey`：弹出 password 输入框，存入 `context.secrets`
- 配置面板 / webview 中提供入口按钮触发该命令

### API 兼容性

采用 **OpenAI Chat Completions** 兼容协议（`POST {apiUrl}`，Bearer token 鉴权，`messages` 数组）。兼容：OpenAI / DeepSeek / Moonshot / Zhipu / 通义千问 / 本地 Ollama / LM Studio 等。

---

## 技术设计

### 架构总览

```
┌─────────────────┐     bridge.request      ┌──────────────────────┐
│  Webview (React)│ ──────────────────────► │  Extension Host       │
│                 │  "generateCommitMessage"│                       │
│  CommitMessage  │ ◄────────────────────── │  aiHandlers.ts        │
│  Area           │      { message }         │    └─ AiCommitService│
│  + AI Button    │                          │         ├─ GitService│
└─────────────────┘                          │         │  (collectDiff)│
                                             │         └─ fetch(AI) │
                                             └──────────────────────┘
```

### 数据流

1. 用户点击 AI 按钮
2. Webview 发送 `generateCommitMessage` 请求，携带 `{ commitListStyle, selectedFiles, repoPath }`
3. Handler 根据 `commitListStyle` 决定 diff 采集策略
4. AiCommitService 拼装 prompt，调用 AI API
5. 返回 `{ message: string }`
6. Webview 填入 textarea

---

## 实现方案

### Phase 1: 配置基础设施

#### 1.1 package.json — contributes.configuration

在 `gitAtlas.commitBadgeMode` 之后追加：

```jsonc
"gitAtlas.aiCommit.apiUrl": {
  "type": "string",
  "default": "",
  "description": "%config.gitAtlas.aiCommit.apiUrl%",
  "order": 10
},
"gitAtlas.aiCommit.model": {
  "type": "string",
  "default": "",
  "description": "%config.gitAtlas.aiCommit.model%",
  "order": 11
},
"gitAtlas.aiCommit.language": {
  "type": "string",
  "default": "auto",
  "enum": ["auto", "en", "zh", "follow-locale"],
  "enumDescriptions": [
    "%config.gitAtlas.aiCommit.language.auto%",
    "%config.gitAtlas.aiCommit.language.en%",
    "%config.gitAtlas.aiCommit.language.zh%",
    "%config.gitAtlas.aiCommit.language.follow-locale%"
  ],
  "description": "%config.gitAtlas.aiCommit.language%",
  "order": 12
},
"gitAtlas.aiCommit.maxDiffChars": {
  "type": "number",
  "default": 8000,
  "minimum": 500,
  "maximum": 50000,
  "description": "%config.gitAtlas.aiCommit.maxDiffChars%",
  "order": 13
}
```

#### 1.2 NLS 国际化

**package.nls.json**（英文源）追加：

```jsonc
"config.gitAtlas.aiCommit.apiUrl": "AI API URL for generating commit messages (OpenAI-compatible Chat Completions endpoint).",
"config.gitAtlas.aiCommit.model": "AI model name (e.g. gpt-4o-mini, deepseek-chat).",
"config.gitAtlas.aiCommit.language": "Language for generated commit messages.",
"config.gitAtlas.aiCommit.language.auto": "Auto-detect from recent git commit history.",
"config.gitAtlas.aiCommit.language.en": "English",
"config.gitAtlas.aiCommit.language.zh": "Chinese",
"config.gitAtlas.aiCommit.language.follow-locale": "Follow VS Code display language",
"config.gitAtlas.aiCommit.maxDiffChars": "Maximum diff characters sent to the AI. Longer diffs are truncated."
```

**package.nls.zh-cn.json** 追加对应中文翻译。

#### 1.3 SecretStorage API Key 命令

在 `package.json` → `contributes.commands` 新增：

```jsonc
{
  "command": "git-atlas.setAiApiKey",
  "title": "%command.gitAtlas.setAiApiKey%"
}
```

NLS：
- `package.nls.json`: `"command.gitAtlas.setAiApiKey": "Git Atlas: Set AI API Key"`
- `package.nls.zh-cn.json`: `"command.gitAtlas.setAiApiKey": "Git Atlas: 设置 AI API Key"`

实现（在 `gitCommands.ts` 或新建 `aiCommands.ts`）：

```typescript
import * as vscode from "vscode";

const SECRET_KEY = "gitAtlas.aiCommit.apiKey";

// 完整实现见 Phase 2.7，此处仅示意核心逻辑。
// context 和 messageRouter 均来自 GitHandlerContext（见 setupGit.ts 注入）。
registerCommand("git-atlas.setAiApiKey", async () => {
  const key = await vscode.window.showInputBox({
    prompt: vscode.l10n.t("Enter your AI API key"),
    password: true,
    placeHolder: "sk-...",
    ignoreFocusOut: true,
  });
  if (key !== undefined) {
    await context.secrets.store(SECRET_KEY, key);
    vscode.window.showInformationMessage(
      vscode.l10n.t("AI API key saved."),
    );
    messageRouter.broadcastEvent("aiConfigChanged", {});
  }
});
```

另注册 `git-atlas.clearAiApiKey` 清除命令。

> **决策依据**：SecretStorage 是 VSCode 存储 API Key 的推荐方式（加密存储于操作系统钥匙串），不会出现在 settings.json 明文中。配置 URL/model 留在 settings.json（非敏感信息，可随 workspace 共享）。

---

### Phase 2: 后端 AI 服务

#### 2.1 新建 `src/ai/aiCommitService.ts`

核心职责：采集 diff → 拼装 prompt → 调用 AI → 返回 message。

```typescript
import * as vscode from "vscode";
import type { GitService } from "../git/gitService";

const SECRET_KEY = "gitAtlas.aiCommit.apiKey";

export interface AiCommitConfig {
  apiUrl: string;
  model: string;
  apiKey: string;
  language: string;
  maxDiffChars: number;
}

export interface DiffContext {
  /** 采集到的 diff 文本 */
  diff: string;
  /** 文件状态摘要列表 */
  fileSummary: { path: string; status: string; staged: boolean }[];
  /** 实际使用的来源描述（用于 UI 反馈） */
  source: "staged" | "selected" | "all";
}

export class AiCommitService {
  constructor(private context: vscode.ExtensionContext) {}

  /** 读取配置 + secret。返回 null 表示未完成配置。 */
  async getConfig(): Promise<AiCommitConfig | null> {
    const config = vscode.workspace.getConfiguration("gitAtlas.aiCommit");
    const apiUrl = config.get<string>("apiUrl", "").trim();
    const model = config.get<string>("model", "").trim();
    const language = config.get<string>("language", "auto");
    const maxDiffChars = config.get<number>("maxDiffChars", 8000);
    const apiKey = (await this.context.secrets.get(SECRET_KEY)) ?? "";

    if (!apiUrl || !apiKey || !model) return null;
    return { apiUrl, model, apiKey, language, maxDiffChars };
  }

  /** 返回是否已配置（不含 key 明文，供前端判断按钮可用性）。 */
  async getStatus(): Promise<{ configured: boolean; hasApiKey: boolean; apiUrl: string; model: string }> {
    const config = vscode.workspace.getConfiguration("gitAtlas.aiCommit");
    const apiUrl = config.get<string>("apiUrl", "").trim();
    const model = config.get<string>("model", "").trim();
    const apiKey = (await this.context.secrets.get(SECRET_KEY)) ?? "";
    return {
      configured: !!apiUrl && !!apiKey && !!model,
      hasApiKey: !!apiKey,
      apiUrl,
      model,
    };
  }

  /**
   * 根据 commitListStyle + selectedFiles 采集 diff。
   *
   * 策略：
   *   vscode → staged 优先，无 staged 则全部改动
   *   jetbrains → selectedFiles 优先，无选中则全部改动
   */
  async collectDiff(
    gitService: GitService,
    commitListStyle: "vscode" | "jetbrains",
    selectedFiles: string[],
  ): Promise<DiffContext> {
    const changes = await gitService.getWorkingTreeChanges();

    if (commitListStyle === "vscode") {
      const stagedFiles = changes.filter((f) => f.staged);
      if (stagedFiles.length > 0) {
        const diff = await gitService.getStagedPatch();
        return {
          diff,
          fileSummary: stagedFiles.map((f) => ({ path: f.path, status: f.status, staged: true })),
          source: "staged",
        };
      }
    } else {
      // jetbrains
      if (selectedFiles.length > 0) {
        const diff = await gitService.generatePatchForFiles(selectedFiles);
        const summary = changes
          .filter((f) => selectedFiles.includes(f.path))
          .map((f) => ({ path: f.path, status: f.status, staged: f.staged }));
        return { diff, fileSummary: summary, source: "selected" };
      }
    }

    // Fallback: all changes
    const diff = await gitService.generatePatchAll();
    return {
      diff,
      fileSummary: changes.map((f) => ({ path: f.path, status: f.status, staged: f.staged })),
      source: "all",
    };
  }

  /**
   * 调用 AI API 生成 commit message。
   *
   * 当 language === "auto" 时，从 git 历史检测项目使用的语言（采样最近
   * 20 条 commit message，若多数含 CJK 字符则判定为中文）。
   */
  async generateMessage(
    diffContext: DiffContext,
    gitService: GitService,
    cfg: AiCommitConfig,
  ): Promise<string> {
    // Resolve effective language (auto → detect from history)
    const language = await this.resolveLanguage(cfg.language, gitService);

    // Truncate diff
    const diff = this.truncateDiff(diffContext.diff, cfg.maxDiffChars);

    // Build prompt
    const systemPrompt = this.buildSystemPrompt(language);
    const userPrompt = this.buildUserPrompt(diff, diffContext.fileSummary);

    // Call API
    const response = await this.callApi(cfg, systemPrompt, userPrompt);
    return this.cleanMessage(response);
  }

  private truncateDiff(diff: string, maxChars: number): string {
    if (diff.length <= maxChars) return diff;
    // Keep the head of the diff + a truncation notice
    const truncated = diff.slice(0, maxChars);
    return truncated + "\n\n... [diff truncated, showing first " + maxChars + " chars]";
  }

  private buildSystemPrompt(language: string): string {
    const langInstruction = this.getLanguageInstruction(language);

    return [
      "You are an expert commit message generator.",
      "Analyze the provided git diff and generate a concise, meaningful commit message.",
      "",
      "Follow the Conventional Commits specification:",
      "  <type>(<optional scope>): <subject>",
      "  <blank line>",
      "  <optional body>",
      "",
      "Types: feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert",
      "",
      "Rules:",
      "- Use the imperative mood in the subject line (e.g. 'add' not 'added')",
      "- Subject line: max 72 characters, lowercase, no trailing period",
      "- Add a body paragraph only when the change is complex or non-obvious",
      "- Wrap body lines at 100 characters",
      "- Be specific: reference what actually changed, not generic descriptions",
      "- Output ONLY the commit message. No explanation, no code blocks, no quotes, no markdown.",
      langInstruction,
    ].join("\n");
  }

  /**
   * 将配置的 language 值解析为最终生效的 "en" | "zh"。
   *
   * - "en" / "zh" → 直接使用
   * - "follow-locale" → 读取 vscode.env.language
   * - "auto" → 从 git 历史 commit message 检测
   */
  private async resolveLanguage(
    language: string,
    gitService: GitService,
  ): Promise<"en" | "zh"> {
    if (language === "zh") return "zh";
    if (language === "en") return "en";
    if (language === "follow-locale") {
      return vscode.env.language.startsWith("zh") ? "zh" : "en";
    }
    // "auto" — detect from git history
    return this.detectLanguageFromHistory(gitService);
  }

  /**
   * 从最近的 commit message 检测项目使用的语言。
   *
   * 算法：采样最近 20 条 commit message 的 subject，统计含 CJK 字符
   * （\u4e00-\u9fff 统一汉字、\u3400-\u4dbf 扩展A）的比例。若超过
   * 40% 的 message 含 CJK 字符，判定为中文。
   *
   * 阈值 40%（而非 50%）的原因：很多项目 commit message 是中英混合
   * （如 "fix: 修复登录问题"），纯英文 subject 会拉低比例，所以阈值
   * 适当放宽。
   *
   * 边界情况：无历史记录（全新仓库）→ 回退到 VSCode 显示语言。
   */
  private async detectLanguageFromHistory(
    gitService: GitService,
  ): Promise<"en" | "zh"> {
    try {
      const messages = await gitService.getRecentCommitMessages(20);
      if (messages.length === 0) {
        // 全新仓库，无历史参考 → 跟随 VSCode 语言
        return vscode.env.language.startsWith("zh") ? "zh" : "en";
      }

      // CJK 统一汉字 + 扩展A区
      const cjkRegex = /[\u4e00-\u9fff\u3400-\u4dbf]/;
      const cjkCount = messages.filter((msg) => cjkRegex.test(msg)).length;
      const ratio = cjkCount / messages.length;

      return ratio >= 0.4 ? "zh" : "en";
    } catch {
      // 检测失败（git 命令出错等）→ 安全回退
      return "en";
    }
  }

  /**
   * 返回语言指令。注意：调用前已通过 resolveLanguage 将 auto/follow-locale
   * 解析为 "en" | "zh"，因此这里只需处理这两个值。
   */
  private getLanguageInstruction(language: string): string {
    if (language === "zh") {
      return "- Write the commit message in Chinese (中文).";
    }
    return "- Write the commit message in English.";
  }

  private buildUserPrompt(
    diff: string,
    fileSummary: { path: string; status: string; staged: boolean }[],
  ): string {
    const fileList = fileSummary
      .map((f) => `  ${f.status.padEnd(10)} ${f.path}`)
      .join("\n");

    return [
      "Changed files:",
      fileList || "  (none)",
      "",
      "Diff:",
      "```diff",
      diff || "(empty)",
      "```",
    ].join("\n");
  }

  private async callApi(
    cfg: AiCommitConfig,
    systemPrompt: string,
    userPrompt: string,
  ): Promise<string> {
    const body = {
      model: cfg.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.3,
      max_tokens: 500,
      stream: false,
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    try {
      const resp = await fetch(cfg.apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${cfg.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        throw new Error(`AI API returned ${resp.status}: ${text.slice(0, 200)}`);
      }

      const data = (await resp.json()) as {
        choices?: { message?: { content?: string } }[];
      };

      const content = data.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error("AI API returned an empty response.");
      }
      return content;
    } catch (err) {
      // AbortError → 友好提示（否则用户看到晦涩的 "The operation was aborted"）
      if (err instanceof Error && err.name === "AbortError") {
        throw new Error("AI request timed out after 30 seconds.");
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  private cleanMessage(raw: string): string {
    // Strip code fences if the model wrapped output despite instructions
    let msg = raw.trim();
    if (msg.startsWith("```")) {
      msg = msg.replace(/^```[a-z]*\n?/, "").replace(/```\s*$/, "");
    }
    // Strip leading/trailing quotes
    msg = msg.replace(/^["'`]+|["'`]+$/g, "");
    return msg.trim();
  }
}
```

> **关于 `fetch`**：Node.js 18+ 内置全局 `fetch`。VSCode 运行在 Electron 环境（Node 18+），可直接使用。Vite externals 列表中未排除 `fetch`（它是全局 API，非 require），无需额外配置。

#### 2.2 GitService 新增方法

在 `src/git/gitService.ts` 新增：

```typescript
/**
 * 获取已暂存改动的 unified diff（git diff --cached）。
 * 用于 AI commit message 生成时 VSCode 风格的"暂存优先"策略。
 */
async getStagedPatch(): Promise<string> {
  try {
    return await this.execGit(["diff", "--cached"]);
  } catch {
    return "";
  }
}
```

> 已有 `generatePatchForFiles`（private）和 `generatePatchAll`（private）可复用。直接将它们的可见性改为 `public`（GitService 是扩展内部类，无外部消费者，无需保持向后兼容），AiCommitService 直接调用 `gitService.generatePatchForFiles(...)` / `gitService.generatePatchAll()`。无需新增包装方法。

#### 2.3 新建 `src/commands/gitHandlers/aiHandlers.ts`

```typescript
import * as vscode from "vscode";
import type { GitHandlerContext } from "../gitContext";
import { requireGit, withProgress } from "../gitContext";
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

      return withProgress(ctx, async () => {
        // 将已读取的 cfg 传入，避免 generateMessage 内部重复读取 SecretStorage
        const message = await aiService.generateMessage(diffContext, gitService, cfg);
        return { message, source: diffContext.source };
      });
    }),
  );

  // 通过 webview 触发 API Key 设置（命令委托）
  messageRouter.handle("setAiApiKey", async () => {
    await vscode.commands.executeCommand("git-atlas.setAiApiKey");
    return aiService.getStatus();
  });
}
```

#### 2.4 注册 Handler

**`src/commands/gitHandlers/index.ts`** 追加：

```typescript
import { registerAiHandlers } from "./aiHandlers";

export function registerGitHandlers(ctx: GitHandlerContext): void {
  // ... existing
  registerAiHandlers(ctx);  // ← 新增
}
```

#### 2.5 协议注册

**`src/messages/protocol.ts`** → `CommandType` 追加：

```typescript
| "getAiConfig"
| "generateCommitMessage"
| "setAiApiKey"
```

**`EventType`** 追加：

```typescript
| "aiConfigChanged"
```

**`webview/src/shared/bridge/types.ts`** → `CommandType` 同步追加相同的三个命令。

#### 2.6 扩展 GitHandlerContext

`GitHandlerContext` 已包含 `context: ExtensionContext`，`AiCommitService` 直接从 `ctx.context` 构造即可，**无需修改接口**。

#### 2.7 命令注册（setAiApiKey / clearAiApiKey）

在 `src/commands/gitCommands.ts` 或新建 `src/commands/aiCommands.ts`：

```typescript
import * as vscode from "vscode";
import type { GitHandlerContext } from "./gitContext";

const SECRET_KEY = "gitAtlas.aiCommit.apiKey";

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
        await ctx.context.secrets.store(SECRET_KEY, key);
        vscode.window.showInformationMessage(vscode.l10n.t("AI API key saved."));
        ctx.messageRouter.broadcastEvent("aiConfigChanged", {});
      }
    }),
  );

  ctx.context.subscriptions.push(
    vscode.commands.registerCommand("git-atlas.clearAiApiKey", async () => {
      await ctx.context.secrets.delete(SECRET_KEY);
      vscode.window.showInformationMessage(vscode.l10n.t("AI API key cleared."));
      ctx.messageRouter.broadcastEvent("aiConfigChanged", {});
    }),
  );
}
```

在 `setupGit.ts` 中调用 `registerAiCommands(ctx)`。

在 `package.json` → `contributes.commands` 追加：

```jsonc
{ "command": "git-atlas.setAiApiKey", "title": "%command.gitAtlas.setAiApiKey%" },
{ "command": "git-atlas.clearAiApiKey", "title": "%command.gitAtlas.clearAiApiKey%" }
```

---

### Phase 3: 前端实现

#### 3.1 Bridge 超时扩展

当前 `vscode-bridge.ts` 中 request 超时硬编码为 10 秒。AI API 调用可能需要 5-20 秒。

**方案**：为 `request` 方法增加可选超时参数。

`webview/src/shared/bridge/types.ts`：

```typescript
export interface Bridge {
  request(
    command: CommandType | string,
    params?: Record<string, unknown>,
    options?: { timeout?: number },
  ): Promise<unknown>;
  onEvent(handler: (event: string, data: unknown) => void): () => void;
  getState(): unknown;
  setState(state: unknown): void;
}
```

`webview/src/shared/bridge/vscode-bridge.ts`：

```typescript
request(command, params = {}, options?: { timeout?: number }) {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const timeout = setTimeout(
      () => {
        pendingRequests.delete(id);
        reject(new Error(`Request '${command}' timed out`));
      },
      options?.timeout ?? 10_000,  // 默认 10s，AI 请求传 60s
    );
    // ...rest unchanged
  });
}
```

调用方：

```typescript
await bridge.request("generateCommitMessage", params, { timeout: 60_000 });
```

#### 3.2 Commit Store 扩展

`webview/src/shared/store/commit-store.ts` 新增：

**State 字段：**

```typescript
// AI commit message 生成
aiGenerating: boolean;
aiConfigured: boolean;  // apiUrl + apiKey 是否齐备
```

**Actions：**

```typescript
fetchAiConfig: () => Promise<void>;
generateCommitMessage: () => Promise<void>;
```

**实现：**

```typescript
aiGenerating: false,
aiConfigured: false,

async fetchAiConfig() {
  try {
    const result = (await bridge.request("getAiConfig")) as {
      configured: boolean;
      hasApiKey: boolean;
      apiUrl: string;
      model: string;
    };
    set({ aiConfigured: result?.configured ?? false });
  } catch (err) {
    console.error("fetchAiConfig failed:", err);
  }
},

async generateCommitMessage() {
  // ★ Capture seq at issue time for the in-flight race guard.
  // 用户在 AI 请求进行中（5-20s）切换 repo 时，repoChanged 事件会清空
  // commitMessage，但 AI 返回后会用旧 repo 的结果覆盖。通过 seq 检查丢弃。
  const mySeq = get().repoSeq;
  const { commitListStyle, selectedFiles, changes } = get();
  // 无改动直接返回
  if (changes.length === 0) return;

  set({ aiGenerating: true });
  try {
    // 将 selectedFiles Set 转为路径数组（去重 path，去掉 staged 标记）
    const filePaths = [...selectedFiles].map((key) => key.split(":")[0]);
    // 去重
    const uniquePaths = [...new Set(filePaths)];

    const result = (await bridge.request(
      "generateCommitMessage",
      { commitListStyle, selectedFiles: uniquePaths, repoPath: get().currentRepoPath },
      { timeout: 60_000 },
    )) as { message?: string; source?: string; status?: string };

    // ★ Race guard: repo 已切换，丢弃结果
    if (mySeq !== get().repoSeq) return;

    // NOT_GIT_REPO 哨兵检查
    if (result?.status === "not_git_repo") {
      bridge.request("showErrorNotification", {
        message: t("No active repository."),
      }).catch(() => {});
      return;
    }

    if (result?.message) {
      set({ commitMessage: result.message });
    }
  } catch (err) {
    // ★ Race guard: repo 已切换，静默丢弃错误
    if (mySeq !== get().repoSeq) return;
    const msg = err instanceof Error ? err.message : String(err);
    console.error("generateCommitMessage failed:", msg);
    // 显示错误通知（通过 bridge 调用 host 端通知）
    bridge.request("showErrorNotification", { message: msg }).catch(() => {});
  } finally {
    // ★ Only clear loading if we're still the active seq.
    if (mySeq === get().repoSeq) set({ aiGenerating: false });
  }
},
```

**initRepo 中追加 AI 配置拉取：**

```typescript
async initRepo() {
  // ...existing code...
  await Promise.all([
    get().refresh(),
    get().fetchRepoStatuses(),
    get().fetchGitConfig(),
    get().fetchAiConfig(),  // ← 新增
  ]);
},
```

**事件监听追加：**

```typescript
bridge.onEvent((event, data) => {
  // AI 配置变更（setAiApiKey / clearAiApiKey 命令触发）
  if (event === "aiConfigChanged") {
    useCommitStore.getState().fetchAiConfig();
    return;
  }
  // gitAtlas.* 配置变更（用户在 settings.json 编辑 apiUrl/model/language 等）
  // setupGit 的 onDidChangeConfiguration 监听会广播 gitConfigChanged，
  // 这里需要同时刷新 AI 配置状态，否则用户在 settings 中填好 URL 后按钮仍显示"未配置"
  if (event === "gitConfigChanged") {
    useCommitStore.getState().fetchGitConfig();
    useCommitStore.getState().fetchAiConfig();  // ← 新增
    return;
  }
  // ...other existing events (repoChanged, commitStateChanged, etc.)...
});
```

#### 3.3 CommitMessageArea UI

在 `.commit-amend-row` 中，历史按钮旁新增 AI 生成按钮：

```tsx
export function CommitMessageArea() {
  const {
    // ...existing
    changes,
    aiGenerating,
    aiConfigured,
    generateCommitMessage,
  } = useCommitStore();

  // 按钮禁用条件：无改动 / 未配置 / 生成中
  const hasChanges = changes.length > 0;
  const canGenerate = hasChanges && aiConfigured && !aiGenerating;

  const handleGenerate = useCallback(async () => {
    if (!canGenerate) return;
    await generateCommitMessage();
  }, [canGenerate, generateCommitMessage]);

  // ...existing

  return (
    <div className="commit-message-area">
      <textarea ... />

      <div className="commit-amend-row">
        <label> ... Amend ... </label>

        {/* AI 生成按钮 */}
        <Tooltip text={t("Generate commit message with AI")}>
          <span
            onClick={handleGenerate}
            style={{
              cursor: canGenerate ? "pointer" : "default",
              display: "inline-flex",
              alignItems: "center",
              borderRadius: 3,
              padding: 2,
              opacity: canGenerate ? 0.6 : 0.3,
              transition: "background 0.15s, opacity 0.15s",
            }}
            onMouseEnter={(e) => {
              if (canGenerate) (e.currentTarget as HTMLElement).style.opacity = "1";
            }}
            onMouseLeave={(e) => {
              if (canGenerate) (e.currentTarget as HTMLElement).style.opacity = "0.6";
            }}
          >
            {aiGenerating ? <SpinnerIcon /> : <SparkleIcon />}
          </span>
        </Tooltip>

        {/* 历史按钮（已有） */}
        <Tooltip text={t("Recent commit messages")}> ... </Tooltip>
      </div>
      ...
    </div>
  );
}
```

**图标**：React webview 使用 `unplugin-icons`（SVG 组件），**不加载 codicon 字体 CSS**。必须通过 import 导入图标组件。

```tsx
import SparkleIcon from "~icons/codicon/sparkle";
import LoadingIcon from "~icons/codicon/loading";

// 在组件中使用（loading 状态需自定义 CSS 旋转动画，codicon-modifier-spin 不可用）
{aiGenerating ? (
  <LoadingIcon style={{ fontSize: 14, animation: "ai-spin 1s linear infinite" }} />
) : (
  <SparkleIcon style={{ fontSize: 14 }} />
)}
```

在 `commit.css` 中追加旋转动画：

```css
@keyframes ai-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
```

> 已验证 `@vscode/codicons` 包含 `sparkle.svg` 和 `loading.svg`，`unplugin-icons` 可正常解析。项目中其他组件（如 `BranchSidebar.tsx`、`Toolbar.tsx`）均使用此模式。

**未配置时的提示**：当 `aiConfigured === false` 时，tooltip 改为提示配置引导：

```tsx
const tooltipText = aiConfigured
  ? t("Generate commit message with AI")
  : t("AI not configured. Click to set up.");
```

点击未配置按钮时，跳转到设置或触发 API Key 命令：

```tsx
const handleGenerate = useCallback(async () => {
  if (aiGenerating) return;
  if (!aiConfigured) {
    // 触发配置流程：先设 key，再刷新
    // 超时设 120s：用户需要在 AI 平台复制 key，10s 默认超时不够
    await bridge.request("setAiApiKey", {}, { timeout: 120_000 });
    return;
  }
  if (!hasChanges) return;
  await generateCommitMessage();
}, [aiConfigured, hasChanges, aiGenerating, generateCommitMessage]);
```

#### 3.4 国际化

`l10n/bundle.l10n.zh-cn.json` 追加：

```jsonc
"Generate commit message with AI": "使用 AI 生成提交信息",
"AI not configured. Click to set up.": "AI 未配置，点击设置",
"Generating commit message...": "正在生成提交信息...",
"AI API key saved.": "AI API 密钥已保存。",
"AI API key cleared.": "AI API 密钥已清除。",
"Enter your AI API key": "输入 AI API 密钥",
"No changes to generate a commit message from.": "没有可用于生成提交信息的改动。",
"AI API returned an empty response.": "AI API 返回了空响应。"
```

---

### Phase 4: 边界与错误处理

#### 4.1 Diff 为空

当 `collectDiff` 返回空 diff 且空 fileSummary 时，handler 抛出错误 `"No changes to generate a commit message from."`。前端通过 catch 显示通知。

> 正常流程中按钮在无改动时已禁用，但防御性检查仍然需要（race condition: 用户点击后、请求到达前可能有其他进程提交了改动）。

#### 4.2 Diff 过大

`maxDiffChars` 截断。截断后在 diff 末尾追加 `... [diff truncated]` 提示，AI 能理解并基于可见部分生成。

#### 4.3 API 超时 / 网络错误

- `fetch` 的 `AbortController` 30 秒超时
- 错误信息透传到前端通知

#### 4.4 API 返回非预期格式

检查 `data.choices?.[0]?.message?.content`，为空时抛 `"AI API returned an empty response."`。

#### 4.5 amend 模式

amend 模式下不需要改动文件也能提交，但 AI 生成基于 diff，因此按钮禁用条件不包含 amend 检查——按钮仅看 `hasChanges`。

#### 4.6 多 repo 切换

`generateCommitMessage` handler 通过 `requireGit` + `params.repoPath` 解析目标 GitService，天然支持多 repo。store 中 `currentRepoPath` 会随 repo 切换更新。

#### 4.7 Repo 切换竞态

store 中已有 `repoSeq` 竞态保护。AI 生成请求耗时较长（5-20s），期间用户可能切换 repo。`generateCommitMessage` 的 store action 中通过 `mySeq` 检查丢弃过期结果（**已在 §3.2 实现代码中合并**，此处不再重复）：

```typescript
async generateCommitMessage() {
  const mySeq = get().repoSeq;
  // ...request...
  if (mySeq !== get().repoSeq) return; // repo switched, discard result
  set({ commitMessage: result.message });
}
```

---

## 文件变更清单

### 新建文件

| 文件 | 说明 |
|------|------|
| `src/ai/aiCommitService.ts` | AI 调用 + diff 采集 + prompt 拼装 |
| `src/commands/gitHandlers/aiHandlers.ts` | MessageRouter handler 注册 |
| `src/commands/aiCommands.ts` | VSCode command 注册（setAiApiKey / clearAiApiKey） |

### 修改文件 — 扩展端

| 文件 | 变更 |
|------|------|
| `package.json` | 新增 4 个 `gitAtlas.aiCommit.*` 配置 + 2 个 command |
| `package.nls.json` | 英文 NLS（config + command） |
| `package.nls.zh-cn.json` | 中文 NLS |
| `src/messages/protocol.ts` | `CommandType` +3，`EventType` +1 |
| `src/git/gitService.ts` | 新增 `getStagedPatch()` + 2 个 public 包装方法 |
| `src/commands/gitHandlers/index.ts` | 注册 `registerAiHandlers` |
| `src/commands/gitCommands.ts` | 注册 `registerAiCommands` |
| `src/git/setupGit.ts` | 调用 `registerAiCommands(ctx)` |
| `l10n/bundle.l10n.zh-cn.json` | 新增运行时翻译字符串 |

### 修改文件 — Webview 端

| 文件 | 变更 |
|------|------|
| `webview/src/shared/bridge/types.ts` | `CommandType` +3，`Bridge.request` 增加 options 参数 |
| `webview/src/shared/bridge/vscode-bridge.ts` | `request` 支持 `options.timeout` |
| `webview/src/shared/store/commit-store.ts` | 新增 `aiGenerating` / `aiConfigured` state + actions |
| `webview/src/commit/components/CommitMessageArea.tsx` | 新增 AI 生成按钮 + 图标 |

---

## 实施顺序

```
Phase 1: 配置基础设施
  ├─ package.json + NLS
  └─ SecretStorage 命令注册

Phase 2: 后端 AI 服务（依赖 Phase 1）
  ├─ GitService 新增 diff 方法
  ├─ AiCommitService
  ├─ aiHandlers + 协议注册
  └─ aiCommands + setupGit 接入

Phase 3: 前端（依赖 Phase 2）
  ├─ Bridge 超时扩展
  ├─ commit-store 扩展
  └─ CommitMessageArea UI

Phase 4: 国际化 + 错误处理（与 Phase 3 并行）
```

## 验证清单

- [ ] 未配置 API URL/Key 时按钮禁用，tooltip 提示配置
- [ ] 配置后按钮启用，点击能生成 commit message
- [ ] VSCode 风格：有暂存时基于暂存 diff 生成
- [ ] VSCode 风格：无暂存时基于全部改动生成
- [ ] JetBrains 风格：有勾选时基于勾选文件生成
- [ ] JetBrains 风格：无勾选时基于全部改动生成
- [ ] 无任何改动时按钮禁用
- [ ] 生成中按钮显示 loading 动画，禁用重复点击
- [ ] API 超时/错误时显示通知
- [ ] 多 repo 切换后生成针对新 repo
- [ ] commit message 语言配置生效（auto/en/zh/follow-locale）
- [ ] `auto` 模式：中文历史仓库 → 生成中文 message
- [ ] `auto` 模式：英文历史仓库 → 生成英文 message
- [ ] `auto` 模式：全新仓库无历史 → 回退到 VSCode 显示语言
- [ ] 大 diff 被正确截断
- [ ] 生成的 message 不含 markdown 代码块包裹
