/**
 * 思考/推理模式的 provider 预设。
 *
 * 不同厂商的 OpenAI 兼容 API 对"开启思考"使用不同的请求体字段：
 *   - 智谱 GLM / Kimi / MiMo / DeepSeek-v4：`thinking: { type: "enabled" }`
 *   - 通义千问 Qwen：`enable_thinking: true`（布尔）
 *   - 部分模型（QwQ、-thinking 后缀、kimi-k2.7-code、deepseek-reasoner）思考是
 *     模型自带的，再传思考字段可能报错，因此不传。
 *
 * 所有 5 家的最终答案都在响应的 `message.content`，思考过程在
 * `message.reasoning_content`——调用方只需取 content，无需 provider 分支剥离。
 *
 * 字段约定来源：各厂商官方文档（DeepSeek/GLM/Kimi/Qwen/MiMo）。
 */

export type Provider = "deepseek" | "zhipu" | "moonshot" | "qwen" | "mimo" | "unknown";

export interface ThinkingBehavior {
  /** 合并进请求体以开启思考的字段；{} 表示该模型思考为自带、无需（也不应）传字段。 */
  fields: Record<string, unknown>;
  /** 该 provider 在思考模式下会因自定义采样参数报错（Kimi），需删除 temperature。 */
  dropSamplingParams: boolean;
  /** token 上限字段名：MiMo 用 max_completion_tokens，其余用 max_tokens。 */
  tokenField: "max_tokens" | "max_completion_tokens";
}

/** 开启思考时的 token 预算：推理过程消耗 token，需要为最终答案留余量。 */
export const THINKING_TOKEN_BUDGET = 4096;

/**
 * 根据 API base URL（域名优先）+ model 名识别 provider。
 * 域名匹配失败时回退到 model 名关键词匹配。
 */
export function detectProvider(apiUrl: string, model: string): Provider {
  const m = model.toLowerCase();

  let host = "";
  try {
    host = new URL(apiUrl).hostname.toLowerCase();
  } catch {
    host = apiUrl.toLowerCase();
  }

  // 域名优先
  if (host.includes("deepseek.com")) return "deepseek";
  if (host.includes("bigmodel.cn")) return "zhipu";
  if (host.includes("moonshot.cn") || host.includes("moonshot.ai")) return "moonshot";
  if (host.includes("aliyuncs.com")) return "qwen";
  if (host.includes("xiaomimimo.com")) return "mimo";

  // model 名兜底
  if (m.includes("deepseek")) return "deepseek";
  if (m.includes("glm")) return "zhipu";
  if (m.includes("kimi") || m.includes("moonshot")) return "moonshot";
  if (m.includes("qwen") || m.includes("qwq")) return "qwen";
  if (m.includes("mimo")) return "mimo";

  return "unknown";
}

/**
 * 返回某 provider+model 在开启思考时的请求体行为。
 *
 * 注意：思考自带模型（QwQ、-thinking 后缀、kimi-k2.7-code、deepseek-reasoner）
 * 返回 fields:{} —— 不传思考字段，但它们仍在思考，调用方仍应放大 token 预算。
 */
export function getThinkingBehavior(provider: Provider, model: string): ThinkingBehavior {
  const m = model.toLowerCase();

  switch (provider) {
    case "zhipu":
      return {
        fields: { thinking: { type: "enabled" } },
        dropSamplingParams: false,
        tokenField: "max_tokens",
      };

    case "mimo":
      // MiMo 用 max_completion_tokens，且思考+答案共享该预算。
      return {
        fields: { thinking: { type: "enabled" } },
        dropSamplingParams: false,
        tokenField: "max_completion_tokens",
      };

    case "moonshot": {
      // Kimi 思考模式（含自带思考的模型）强制采样参数，传非标准值会直接报错 → 删 temperature。
      // kimi-k2.7-code* / kimi-k2-thinking 永远思考，传 thinking 字段会报错 → 不传。
      const alwaysOn = m.includes("k2.7-code") || m.includes("thinking");
      return {
        fields: alwaysOn ? {} : { thinking: { type: "enabled" } },
        dropSamplingParams: true,
        tokenField: "max_tokens",
      };
    }

    case "qwen": {
      // QwQ / -thinking 后缀为强制思考模型，不接受 enable_thinking → 不传。
      const alwaysOn = m.includes("qwq") || m.endsWith("-thinking");
      return {
        fields: alwaysOn ? {} : { enable_thinking: true },
        dropSamplingParams: false,
        tokenField: "max_tokens",
      };
    }

    case "deepseek": {
      // deepseek-reasoner（旧）：思考由模型名决定，传 thinking 字段有兼容风险 → 不传。
      // deepseek-v4*（新）：通过 thinking 字段控制。
      // deepseek-chat 等：不支持思考字段。
      if (m.includes("reasoner")) {
        return { fields: {}, dropSamplingParams: false, tokenField: "max_tokens" };
      }
      if (m.includes("v4")) {
        return { fields: { thinking: { type: "enabled" } }, dropSamplingParams: false, tokenField: "max_tokens" };
      }
      return { fields: {}, dropSamplingParams: false, tokenField: "max_tokens" };
    }

    default:
      // 未知 provider：不传思考字段，避免严格服务器返回 400。
      return { fields: {}, dropSamplingParams: false, tokenField: "max_tokens" };
  }
}
