import * as path from "node:path";

/**
 * Normalize a file path to forward slashes.
 *
 * `path.relative()` / `path.join()` return OS-native separators (backslashes
 * on Windows), but git pathspecs, the webview file filter, and cross-platform
 * comparisons all expect POSIX-style forward slashes. No-op on POSIX.
 */
export function toForwardSlash(p: string): string {
  return p.split(path.sep).join("/");
}
