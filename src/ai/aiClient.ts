import * as vscode from "vscode";
import {
  detectProvider,
  getThinkingBehavior,
  THINKING_TOKEN_BUDGET,
} from "./thinkingProviders";
import { logger } from "../utils/logger";

/**
 * 共享 AI 客户端：配置读取（projectAtlas.ai.*）+ OpenAI 兼容 chat 调用。
 *
 * 从 AiCommitService 抽取，供 commit message 与 release changelog 生成共用。
 * 请求构造（thinking 字段注入、Kimi 去 temperature、max_tokens）、空响应
 * 重试、超时/取消联动等行为与原 AiCommitService 完全一致。
 */

/** API key 在 SecretStorage 中的键。 */
export const AI_SECRET_KEY = "projectAtlas.ai.apiKey";

/** 调用 chat API 所需的最小配置子集。 */
export interface AiChatConfig {
  apiUrl: string;
  model: string;
  apiKey: string;
  timeout: number;
  enableThinking: boolean;
  /** 非思考路径的 max_tokens 上限；缺省 500（commit message 足够，长文需调大）。 */
  maxTokens?: number;
}

/** projectAtlas.ai.* 配置段 + secret 的全量读取结果。 */
export interface AiSettings {
  apiUrl: string;
  model: string;
  language: string;
  maxDiffChars: number;
  customInstructions: string;
  timeout: number;
  enableThinking: boolean;
  releasePrompt: string;
  apiKey: string;
}

/** 读取 projectAtlas.ai.* 全部配置项 + SecretStorage 中的 API key。 */
export async function readAiSettings(
  context: vscode.ExtensionContext,
): Promise<AiSettings> {
  const config = vscode.workspace.getConfiguration("projectAtlas.ai");
  return {
    apiUrl: config.get<string>("apiUrl", "").trim(),
    model: config.get<string>("model", "").trim(),
    language: config.get<string>("language", "auto"),
    maxDiffChars: config.get<number>("maxDiffChars", 8000),
    customInstructions: config.get<string>("customInstructions", "").trim(),
    timeout: config.get<number>("timeout", 30),
    enableThinking: config.get<boolean>("enableThinking", false),
    releasePrompt: config.get<string>("releasePrompt", "").trim(),
    apiKey: (await context.secrets.get(AI_SECRET_KEY)) ?? "",
  };
}

/**
 * 空响应的最大重试次数（不含首次）。部分模型/网关偶发地在 HTTP 200
 * 下返回空 content，重试可消除这类瞬时抖动。
 */
const MAX_EMPTY_RETRIES = 2;

/**
 * 调用 AI chat API，并在遇到"HTTP 成功但内容为空"时自动重试。
 *
 * 仅对空响应重试；真正的 HTTP/网络/超时错误会立即抛出，避免对配置类
 * 错误（401/404 等）做无意义重试。空响应通常返回很快，重试成本可控。
 * cancelSignal 中止时立即抛出 "cancelled"（用户取消，区别于超时）。
 */
export async function chat(
  cfg: AiChatConfig,
  systemPrompt: string,
  userPrompt: string,
  cancelSignal: AbortSignal,
): Promise<string> {
  const totalAttempts = MAX_EMPTY_RETRIES + 1;
  let lastDiagnostic = "";

  for (let attempt = 1; attempt <= totalAttempts; attempt++) {
    // 重试前检查取消：用户在两次尝试之间点了取消，立即跳出。
    if (cancelSignal.aborted) {
      logger.warn(`[ai]    cancelled before attempt ${attempt}`);
      throw new Error("cancelled");
    }
    if (attempt > 1) {
      // 重试前短暂线性退避，缓解瞬时模型/网关抖动。
      const backoff = 800 * (attempt - 1);
      logger.log(
        `[ai]    retrying attempt ${attempt}/${totalAttempts} after ${backoff}ms backoff`,
      );
      await sleep(backoff);
    }
    if (cancelSignal.aborted) {
      logger.warn(`[ai]    cancelled before attempt ${attempt}`);
      throw new Error("cancelled");
    }

    const result = await doRequest(cfg, systemPrompt, userPrompt, cancelSignal);
    if (result.content) {
      if (attempt > 1) logger.log(`[ai]    succeeded on attempt ${attempt}`);
      return result.content;
    }
    lastDiagnostic = describeEmptyResponse(result.finishReason, result.raw);
    logger.warn(
      `[ai]    attempt ${attempt}/${totalAttempts}: empty response (${lastDiagnostic})`,
    );
  }

  throw new Error(
    vscode.l10n.t(
      "AI returned an empty response after {0} attempts ({1}).",
      String(totalAttempts),
      lastDiagnostic,
    ),
  );
}

/**
 * 构建请求体。开启思考时按 provider 注入对应思考字段，并放大 token 预算
 * （推理过程消耗 token）；Kimi 思考模式会因自定义采样参数报错，需删除 temperature。
 */
function buildRequestBody(
  cfg: AiChatConfig,
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
    body.max_tokens = cfg.maxTokens ?? 500;
  }

  return body;
}

/**
 * 执行单次 API 请求。HTTP 成功时返回（含空 content）；HTTP/超时/网络错误时抛出。
 * cancelSignal 与每次请求的超时 controller 联动：用户取消时中止 fetch。
 */
async function doRequest(
  cfg: AiChatConfig,
  systemPrompt: string,
  userPrompt: string,
  cancelSignal: AbortSignal,
): Promise<{ content: string; finishReason: string | null; raw: unknown }> {
  const body = buildRequestBody(cfg, systemPrompt, userPrompt);

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
    const resp = await fetch(buildEndpoint(cfg.apiUrl), {
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
        `[ai]      fetch: ${fetchMs}ms -> HTTP ${resp.status}`,
      );
      throw new Error(`AI API returned ${resp.status}: ${text.slice(0, 200)}`);
    }

    const data = await resp.json();
    const { content, finishReason } = extractContent(data);
    logger.log(
      `[ai]      fetch: ${fetchMs}ms -> 200 (contentChars=${content.length}, finishReason=${finishReason ?? "null"})`,
    );
    return { content, finishReason, raw: data };
  } catch (err) {
    // 用户取消优先识别（区别于超时），抛出语义化的 "cancelled"
    if (cancelSignal.aborted) {
      logger.warn(`[ai]      fetch aborted: cancelled by user (after ${fetchMs}ms)`);
      throw new Error("cancelled");
    }
    // AbortError → 友好提示（否则用户看到晦涩的 "The operation was aborted"）
    if (err instanceof Error && err.name === "AbortError") {
      logger.warn(
        `[ai]      fetch aborted: timeout after ${cfg.timeout}s`,
      );
      throw new Error(
        vscode.l10n.t("AI request timed out after {0} seconds.", String(cfg.timeout)),
      );
    }
    logger.warn(
      `[ai]      fetch error: ${String(err).slice(0, 200)}`,
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
function extractContent(data: unknown): { content: string; finishReason: string | null } {
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
function describeEmptyResponse(finishReason: string | null, raw: unknown): string {
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
function buildEndpoint(apiUrl: string): string {
  const normalized = apiUrl.replace(/\/+$/, "");
  if (normalized.endsWith("/chat/completions")) return normalized;
  return normalized + "/chat/completions";
}
