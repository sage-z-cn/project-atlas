import { bridge } from "./bridge";

/**
 * Webview-side i18n.
 *
 * The webview cannot call `vscode.l10n.t()` (it runs in a separate JS context
 * without the VS Code API). Instead, on startup the host ships the active
 * locale's l10n bundle over the bridge (`getL10nBundle`), and this module
 * implements a plain `bundle[key] ?? key` translator that mirrors the
 * `vscode.l10n.t()` contract closely enough for the webview's needs.
 *
 * Usage:
 *   - Call `initI18n()` once, BEFORE first render (see main.tsx), so components
 *     see a populated bundle on their first paint instead of flashing English.
 *   - `t("English string")` → translated string, or the key itself when no
 *     bundle entry exists (the English source string is its own key).
 *   - `t("Found {0} items", count)` → positional `{0}`/`{1}`/... placeholders,
 *     matching vscode.l10n.t's `{n}` convention.
 */

let bundle: Record<string, string> = {};
let locale = "en";

/**
 * Fetch the active locale's bundle from the host. Must run before the first
 * React render so the bundle is populated when components first call t().
 *
 * Never throws on failure — a bridge timeout or missing bundle leaves the
 * module in its default English state (empty bundle → t() returns the key).
 */
export async function initI18n(): Promise<void> {
  try {
    const result = (await bridge.request("getL10nBundle")) as {
      locale?: string;
      bundle?: Record<string, string>;
    };
    locale = result?.locale ?? "en";
    bundle = result?.bundle ?? {};
  } catch (err) {
    // Bridge timeout / host error → stay English. Render still proceeds (the
    // caller wraps this in .finally) so the webview degrades to English keys
    // rather than going blank.
    console.error("initI18n failed, falling back to English:", err);
    locale = "en";
    bundle = {};
  }
}

/** The active locale code (e.g. "zh-cn", "en"). Defaults to "en" until init. */
export function getLocale(): string {
  return locale;
}

/**
 * Translate a key. Falls back to the key itself (the English source string)
 * when no bundle entry exists — so passing an untranslated English string is
 * always safe and yields correct output in English locales.
 *
 * Positional placeholders `{0}`/`{1}`/... are replaced with the corresponding
 * arg (vscode.l10n.t convention). Missing arg indices are replaced with "".
 */
export function t(key: string, ...args: (string | number)[]): string {
  const raw = bundle[key] ?? key;
  if (args.length === 0) return raw;
  return raw.replace(/\{(\d+)\}/g, (_match, index) => {
    const i = Number(index);
    return i >= 0 && i < args.length ? String(args[i]) : "";
  });
}
