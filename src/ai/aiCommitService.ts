import * as vscode from "vscode";
import type { GitService } from "../git/gitService";

const SECRET_KEY = "gitAtlas.aiCommit.apiKey";

export { SECRET_KEY as AI_SECRET_KEY };

export interface AiCommitConfig {
  apiUrl: string;
  model: string;
  apiKey: string;
  language: string;
  maxDiffChars: number;
  customInstructions: string;
  timeout: number;
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

  /** Shared config reader — eliminates duplication between getConfig/getStatus. */
  private async readConfig() {
    const config = vscode.workspace.getConfiguration("gitAtlas.aiCommit");
    return {
      apiUrl: config.get<string>("apiUrl", "").trim(),
      model: config.get<string>("model", "").trim(),
      language: config.get<string>("language", "auto"),
      maxDiffChars: config.get<number>("maxDiffChars", 8000),
      customInstructions: config.get<string>("customInstructions", "").trim(),
      timeout: config.get<number>("timeout", 30),
      apiKey: (await this.context.secrets.get(SECRET_KEY)) ?? "",
    };
  }

  /** 读取配置 + secret。返回 null 表示未完成配置。 */
  async getConfig(): Promise<AiCommitConfig | null> {
    const { apiUrl, model, apiKey, language, maxDiffChars, customInstructions, timeout } = await this.readConfig();
    if (!apiUrl || !apiKey || !model) return null;
    return { apiUrl, model, apiKey, language, maxDiffChars, customInstructions, timeout };
  }

  /** 返回是否已配置（不含 key 明文，供前端判断按钮可用性）。 */
  async getStatus(): Promise<{ configured: boolean; hasApiKey: boolean; apiUrl: string; model: string; timeout: number }> {
    const { apiUrl, model, apiKey, timeout } = await this.readConfig();
    return {
      configured: !!apiUrl && !!apiKey && !!model,
      hasApiKey: !!apiKey,
      apiUrl,
      model,
      timeout,
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
    const systemPrompt = this.buildSystemPrompt(language, cfg.customInstructions);
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

  private buildSystemPrompt(language: string, customInstructions: string): string {
    const langInstruction = this.getLanguageInstruction(language);

    const base = [
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
    ];

    if (customInstructions) {
      base.push("", "Additional instructions from the user (follow these if not conflicting):", customInstructions);
    }

    return base.join("\n");
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
    const timeout = setTimeout(() => controller.abort(), cfg.timeout * 1000);

    try {
      const resp = await fetch(this.buildEndpoint(cfg.apiUrl), {
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
        throw new Error(
          vscode.l10n.t("AI request timed out after {0} seconds.", String(cfg.timeout)),
        );
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

  /**
   * Normalize the user-provided API URL into a full chat completions endpoint.
   *
   * Users typically provide a base URL like:
   *   https://api.openai.com/v1
   *   https://open.bigmodel.cn/api/paas/v4
   *
   * The OpenAI-compatible endpoint requires the /chat/completions suffix. If
   * the URL already ends with it, use as-is; otherwise append it.
   */
  private buildEndpoint(apiUrl: string): string {
    const normalized = apiUrl.replace(/\/+$/, "");
    if (normalized.endsWith("/chat/completions")) return normalized;
    return normalized + "/chat/completions";
  }
}
