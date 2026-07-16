import { bridge } from "./bridge";
import { setI18nBundle, setI18nLocale } from "./i18n-core";

/**
 * Webview-side i18n bootstrap.
 *
 * The webview cannot call `vscode.l10n.t()` (it runs in a separate JS context
 * without the VS Code API). Instead, on startup the host ships the active
 * locale's l10n bundle over the bridge (`getL10nBundle`); initI18n() loads it
 * into the pure-core translator (i18n-core.ts).
 *
 * The translator itself (t/getLocale) is re-exported from i18n-core, which has
 * NO bridge dependency — this lets the bridge module import t() too (e.g. for
 * translating request-timeout errors) without forming a circular graph.
 *
 * Usage:
 *   - Call `initI18n()` once, BEFORE first render (see main.tsx), so components
 *     see a populated bundle on their first paint instead of flashing English.
 *   - `t("English string")` → translated string, or the key itself when no
 *     bundle entry exists (the English source string is its own key).
 *   - `t("Found {0} items", count)` → positional `{0}`/`{1}`/... placeholders,
 *     matching vscode.l10n.t's `{n}` convention.
 */
export { t, getLocale } from "./i18n-core";

/**
 * Fetch the active locale's bundle from the host. Must run before the first
 * React render so the bundle is populated when components first call t().
 *
 * Never throws on failure — a bridge timeout or missing bundle leaves the
 * translator in its default English state (empty bundle → t() returns the key).
 */
export async function initI18n(): Promise<void> {
  try {
    const result = (await bridge.request("getL10nBundle")) as {
      locale?: string;
      bundle?: Record<string, string>;
    };
    setI18nLocale(result?.locale ?? "en");
    setI18nBundle(result?.bundle ?? {});
  } catch (err) {
    // Bridge timeout / host error → stay English. Render still proceeds (the
    // caller wraps this in .finally) so the webview degrades to English keys
    // rather than going blank.
    console.error("initI18n failed, falling back to English:", err);
    setI18nLocale("en");
    setI18nBundle({});
  }
}
