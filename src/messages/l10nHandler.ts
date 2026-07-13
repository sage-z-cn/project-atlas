import * as vscode from "vscode";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { MessageRouter } from "./messageRouter";

/**
 * i18n bridge handler（子系统无关）。
 *
 * webview 运行在独立 JS 上下文，无法调用 `vscode.l10n.t()`，故由 host 端读取
 * l10n bundle JSON 一次性下发给 webview；webview 自行实现 `t()` 做
 * `bundle[key] ?? key` 查表（见 webview/src/shared/i18n.ts）。
 *
 * locale 解析对齐 VSCode 自身约定：`vscode.env.language` 持有当前 locale
 * （如 "zh-cn"/"en"/"en-US"）。英文是源语言——bundle 的 key 即英文原文——
 * 故英文 locale 返回空 bundle，`t()` 直接回退为 key 原文。其他 locale 读取
 * `l10n/bundle.l10n.{locale}.json`；文件缺失/不可读/非法 JSON 也回退为空
 * bundle（优雅降级为英文），绝不抛出，避免阻塞 webview 首次渲染。
 *
 * 供任意子系统的 MessageRouter 注册：Git / Project / Task 各自调用一次。
 */
export function registerL10nBundleHandler(
  messageRouter: MessageRouter,
  context: vscode.ExtensionContext,
): void {
  messageRouter.handle("getL10nBundle", async () => {
    const locale = vscode.env.language; // e.g. "zh-cn", "en", "en-US"

    // English is the source language — keys are English originals, so an empty
    // bundle makes the webview's t() return the key verbatim (correct English).
    // Match both bare "en" and region variants like "en-US"/"en-GB".
    if (locale === "en" || locale.startsWith("en-") || locale.startsWith("en_")) {
      return { locale: "en", bundle: {} };
    }

    const l10nDir = context.asAbsolutePath("l10n");
    const bundlePath = path.join(l10nDir, `bundle.l10n.${locale}.json`);
    try {
      const content = await fs.readFile(bundlePath, "utf-8");
      const bundle = JSON.parse(content) as Record<string, string>;
      return { locale, bundle };
    } catch {
      // Bundle file missing / unreadable / invalid JSON → fall back to English
      // keys. Never throw: the webview awaits this before first render.
      return { locale, bundle: {} };
    }
  });
}
