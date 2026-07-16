import * as vscode from "vscode";
import type { GitService } from "../git/gitService";
import {
  detectProvider,
  getThinkingBehavior,
  THINKING_TOKEN_BUDGET,
} from "./thinkingProviders";
import { logger } from "../utils/logger";

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
    const config = vscode.workspace.getConfiguration("gitAtlas.aiCommit");
    return {
      apiUrl: config.get<string>("apiUrl", "").trim(),
      model: config.get<string>("model", "").trim(),
      language: config.get<string>("language", "auto"),
      maxDiffChars: config.get<number>("maxDiffChars", 8000),
      customInstructions: config.get<string>("customInstructions", "").trim(),
      timeout: config.get<number>("timeout", 30),
      enableThinking: config.get<boolean>("enableThinking", false),
      apiKey: (await this.context.secrets.get(SECRET_KEY)) ?? "",
    };
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
      const response = await this.callApi(cfg, systemPrompt, userPrompt, controller.signal);
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

  /**
   * 空响应的最大重试次数（不含首次）。部分模型/网关偶发地在 HTTP 200
   * 下返回空 content，重试可消除这类瞬时抖动。
   */
  private static readonly MAX_EMPTY_RETRIES = 2;

  /**
   * 调用 AI API，并在遇到"HTTP 成功但内容为空"时自动重试。
   *
   * 仅对空响应重试；真正的 HTTP/网络/超时错误会立即抛出，避免对配置类
   * 错误（401/404 等）做无意义重试。空响应通常返回很快，重试成本可控。
   * cancelSignal 中止时立即抛出 "cancelled"（用户取消，区别于超时）。
   */
  private async callApi(
    cfg: AiCommitConfig,
    systemPrompt: string,
    userPrompt: string,
    cancelSignal: AbortSignal,
  ): Promise<string> {
    const totalAttempts = AiCommitService.MAX_EMPTY_RETRIES + 1;
    let lastDiagnostic = "";

    for (let attempt = 1; attempt <= totalAttempts; attempt++) {
      // 重试前检查取消：用户在两次尝试之间点了取消，立即跳出。
      if (cancelSignal.aborted) {
        logger.warn(`[ai-commit]     cancelled before attempt ${attempt}`);
        throw new Error("cancelled");
      }
      if (attempt > 1) {
        // 重试前短暂线性退避，缓解瞬时模型/网关抖动。
        const backoff = 800 * (attempt - 1);
        logger.log(
          `[ai-commit]     retrying attempt ${attempt}/${totalAttempts} after ${backoff}ms backoff`,
        );
        await this.sleep(backoff);
      }
      if (cancelSignal.aborted) {
        logger.warn(`[ai-commit]     cancelled before attempt ${attempt}`);
        throw new Error("cancelled");
      }

      const result = await this.doRequest(cfg, systemPrompt, userPrompt, cancelSignal);
      if (result.content) {
        if (attempt > 1) logger.log(`[ai-commit]     succeeded on attempt ${attempt}`);
        return result.content;
      }
      lastDiagnostic = this.describeEmptyResponse(result.finishReason, result.raw);
      logger.warn(
        `[ai-commit]     attempt ${attempt}/${totalAttempts}: empty response (${lastDiagnostic})`,
      );
    }

    throw new Error(
      vscode.l10n.t(
        "AI returned an empty response while generating the commit message after {0} attempts ({1}).",
        String(totalAttempts),
        lastDiagnostic,
      ),
    );
  }

  /**
   * 构建请求体。开启思考时按 provider 注入对应思考字段，并放大 token 预算
   * （推理过程消耗 token）；Kimi 思考模式会因自定义采样参数报错，需删除 temperature。
   */
  private buildRequestBody(
    cfg: AiCommitConfig,
    systemPrompt: string,
    userPrompt: string,
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: cfg.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.3,
      stream: false,
    };

    const provider = detectProvider(cfg.apiUrl, cfg.model);
    const behavior = getThinkingBehavior(provider, cfg.model);

    if (cfg.enableThinking) {
      // 合并思考字段（自带思考的模型 fields 为 {}，不传）
      for (const [k, v] of Object.entries(behavior.fields)) {
        body[k] = v;
      }
      // Kimi 思考模式传非标准 temperature 会报错
      if (behavior.dropSamplingParams) {
        delete body.temperature;
      }
      // 放大预算并使用 provider 要求的字段名
      body[behavior.tokenField] = THINKING_TOKEN_BUDGET;
    } else {
      // 显式关闭思考：不能依赖"省略"——GLM-4.6/4.7 等模型在省略 thinking 字段时
      // 默认开启思考，会触发数十秒的推理延迟。对支持关闭的 provider 注入 disable
      // 字段；对无法关闭（自带思考）/未知 provider 为 {}，保持原有"不传"行为。
      for (const [k, v] of Object.entries(behavior.disableFields)) {
        body[k] = v;
      }
      body.max_tokens = 500;
    }

    return body;
  }

  /**
   * 执行单次 API 请求。HTTP 成功时返回（含空 content）；HTTP/超时/网络错误时抛出。
   * cancelSignal 与每次请求的超时 controller 联动：用户取消时中止 fetch。
   */
  private async doRequest(
    cfg: AiCommitConfig,
    systemPrompt: string,
    userPrompt: string,
    cancelSignal: AbortSignal,
  ): Promise<{ content: string; finishReason: string | null; raw: unknown }> {
    const body = this.buildRequestBody(cfg, systemPrompt, userPrompt);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), cfg.timeout * 1000);
    // 把外部取消信号联动到本次请求的 controller
    const onCancel = () => controller.abort();
    if (cancelSignal.aborted) {
      controller.abort();
    } else {
      cancelSignal.addEventListener("abort", onCancel, { once: true });
    }

    const tFetch = Date.now();
    let fetchMs = 0;

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
      fetchMs = Date.now() - tFetch;

      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        logger.warn(
          `[ai-commit]       fetch: ${fetchMs}ms -> HTTP ${resp.status}`,
        );
        throw new Error(`AI API returned ${resp.status}: ${text.slice(0, 200)}`);
      }

      const data = await resp.json();
      const { content, finishReason } = this.extractContent(data);
      logger.log(
        `[ai-commit]       fetch: ${fetchMs}ms -> 200 (contentChars=${content.length}, finishReason=${finishReason ?? "null"})`,
      );
      return { content, finishReason, raw: data };
    } catch (err) {
      // 用户取消优先识别（区别于超时），抛出语义化的 "cancelled"
      if (cancelSignal.aborted) {
        logger.warn(`[ai-commit]       fetch aborted: cancelled by user (after ${fetchMs}ms)`);
        throw new Error("cancelled");
      }
      // AbortError → 友好提示（否则用户看到晦涩的 "The operation was aborted"）
      if (err instanceof Error && err.name === "AbortError") {
        logger.warn(
          `[ai-commit]       fetch aborted: timeout after ${cfg.timeout}s`,
        );
        throw new Error(
          vscode.l10n.t("AI request timed out after {0} seconds while generating the commit message.", String(cfg.timeout)),
        );
      }
      logger.warn(
        `[ai-commit]       fetch error: ${String(err).slice(0, 200)}`,
      );
      throw err;
    } finally {
      clearTimeout(timeout);
      cancelSignal.removeEventListener("abort", onCancel);
    }
  }

  /**
   * 从 OpenAI 兼容的响应中抽取文本内容。
   *
   * 兼容两种 content 形态：
   *   - 字符串（标准 chat completions）
   *   - 内容块数组（多模态格式 [{type:"text",text:"..."}]，部分网关用于纯文本响应）
   * 返回 content 为 "" 表示未抽取到有效文本（调用方据此决定是否重试）。
   */
  private extractContent(data: unknown): { content: string; finishReason: string | null } {
    const choice = (
      data as { choices?: { finish_reason?: string; message?: unknown }[] }
    )?.choices?.[0];
    const finishReason = choice?.finish_reason ?? null;
    const message = choice?.message as
      | { content?: string | { type?: string; text?: string }[] }
      | undefined;

    let content = "";
    if (message) {
      if (typeof message.content === "string") {
        content = message.content;
      } else if (Array.isArray(message.content)) {
        content = message.content
          .filter(
            (p): p is { type: "text"; text: string } =>
              !!p && p.type === "text" && typeof p.text === "string",
          )
          .map((p) => p.text)
          .join("\n");
      }
    }
    return { content, finishReason };
  }

  /** 为空响应生成诊断摘要（finish_reason + 响应 id），用于最终错误信息。 */
  private describeEmptyResponse(finishReason: string | null, raw: unknown): string {
    const id = (raw as { id?: string })?.id;
    const parts: string[] = [];
    if (finishReason) {
      parts.push(`finish_reason=${finishReason}`);
    }
    if (id) {
      parts.push(`id=${id}`);
    }
    return parts.join(", ") || "no diagnostics";
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
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
