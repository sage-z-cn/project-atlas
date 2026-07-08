import * as vscode from "vscode";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { GitHandlerContext } from "../gitContext";

/**
 * i18n bridge handler.
 *
 * The webview cannot call `vscode.l10n.t()` (it runs in a separate JS context
 * without the VS Code API), so the host reads the l10n bundle JSON from disk
 * and ships it to the webview once on startup. The webview then implements its
 * own `t()` that does plain `bundle[key] ?? key` lookups (see
 * `webview/src/shared/i18n.ts`).
 *
 * Locale resolution mirrors VS Code's own l10n convention: `vscode.env.language`
 * holds the active locale (e.g. "zh-cn", "en", "en-US"). English is the source
 * language — bundle keys ARE the English strings — so for an English locale we
 * return an empty bundle and `t()` falls through to the key verbatim. For any
 * other locale we read `l10n/bundle.l10n.{locale}.json`; a missing/unreadable
 * file also falls back to an empty bundle (graceful degradation to English)
 * rather than throwing and blocking the webview from rendering.
 */
export function registerI18nHandlers(ctx: GitHandlerContext): void {
  const { messageRouter, context } = ctx;

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
