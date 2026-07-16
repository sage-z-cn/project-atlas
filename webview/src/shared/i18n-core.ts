/**
 * Pure i18n core: bundle state + t() translator.
 *
 * Deliberately has NO dependency on the bridge, so the bridge module can
 * import t() without forming a circular graph (bridge ← i18n ← bridge).
 * The bridge-dependent bootstrap (fetching the bundle from the host) lives
 * in i18n.ts and feeds this module via setI18nBundle()/setI18nLocale().
 *
 * t() mirrors vscode.l10n.t closely enough for webview needs:
 *   - bundle[key] ?? key  (English source string is its own key)
 *   - positional {0}/{1}/... placeholders
 */

let bundle: Record<string, string> = {};
let locale = "en";

/** Load a locale's bundle into the translator state. */
export function setI18nBundle(next: Record<string, string>): void {
  bundle = next;
}

/** Set the active locale code (e.g. "zh-cn", "en"). */
export function setI18nLocale(next: string): void {
  locale = next;
}

/** The active locale code. Defaults to "en" until initialized. */
export function getLocale(): string {
  return locale;
}

/**
 * Translate a key. Falls back to the key itself (the English source string)
 * when no bundle entry exists — passing an untranslated English string is
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
