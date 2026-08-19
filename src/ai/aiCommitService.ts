import * as vscode from "vscode";
import type { GitService } from "../git/gitService";
import { detectProvider } from "./thinkingProviders";
import { logger } from "../utils/logger";
import { chat, readAiSettings } from "./aiClient";

export { AI_SECRET_KEY } from "./aiClient";

export interface AiCommitConfig {
  apiUrl: string;
  model: string;
  apiKey: string;
  language: string;
  maxDiffChars: number;
  customInstructions: string;
  timeout: number;
  enableThinking: boolean;
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
  /** 当前进行中的生成请求的 AbortController；null 表示无在途请求。供 cancelGeneration 使用。 */
  private currentAbort: AbortController | null = null;

  constructor(private context: vscode.ExtensionContext) {}

  /** Shared config reader — eliminates duplication between getConfig/getStatus. */
  private async readConfig() {
    return readAiSettings(this.context);
  }

  /** 读取配置 + secret。返回 null 表示未完成配置。 */
  async getConfig(): Promise<AiCommitConfig | null> {
    const { apiUrl, model, apiKey, language, maxDiffChars, customInstructions, timeout, enableThinking } = await this.readConfig();
    if (!apiUrl || !apiKey || !model) return null;
    return { apiUrl, model, apiKey, language, maxDiffChars, customInstructions, timeout, enableThinking };
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
    // 建立本次生成的 AbortController 并登记到实例，cancelGeneration() 可据此中止。
    const controller = new AbortController();
    this.currentAbort = controller;

    try {
      logger.log(
        `[ai-commit]     model=${cfg.model}, provider=${detectProvider(cfg.apiUrl, cfg.model)}, thinking=${cfg.enableThinking}, maxDiffChars=${cfg.maxDiffChars}, timeout=${cfg.timeout}s`,
      );

      // Resolve effective language (auto → detect from history)
      let t0 = Date.now();
      const language = await this.resolveLanguage(cfg.language, gitService);
      logger.log(`[ai-commit]     resolveLanguage: ${Date.now() - t0}ms (=> ${language})`);

      // Truncate diff
      const diff = this.truncateDiff(diffContext.diff, cfg.maxDiffChars);

      // Build prompt
      t0 = Date.now();
      const systemPrompt = this.buildSystemPrompt(language, cfg.customInstructions);
      const userPrompt = this.buildUserPrompt(diff, diffContext.fileSummary);
      logger.log(
        `[ai-commit]     prompt build: ${Date.now() - t0}ms (system=${systemPrompt.length} chars, user=${userPrompt.length} chars, diffUsed=${diff.length})`,
      );

      // Call API（传入取消信号，用户取消时中止 fetch 并跳出重试循环）
      t0 = Date.now();
      const response = await chat(cfg, systemPrompt, userPrompt, controller.signal);
      logger.log(
        `[ai-commit]     callApi: ${Date.now() - t0}ms (respChars=${response.length})`,
      );
      return this.cleanMessage(response);
    } finally {
      if (this.currentAbort === controller) {
        this.currentAbort = null;
      }
    }
  }

  /** 取消当前进行中的生成请求（无在途请求时为空操作）。 */
  cancelGeneration(): void {
    this.currentAbort?.abort();
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
