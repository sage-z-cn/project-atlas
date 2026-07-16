import * as vscode from "vscode";

/**
 * Map a file extension to a VS Code language id.
 *
 * Extracted from reference project extension.ts (lines 1577-1613).
 * Used by getFileVersions handler to surface syntax highlighting metadata.
 */
export function extToLanguage(ext: string): string {
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "typescriptreact",
    js: "javascript",
    jsx: "javascriptreact",
    py: "python",
    rb: "ruby",
    go: "go",
    rs: "rust",
    java: "java",
    kt: "kotlin",
    swift: "swift",
    c: "c",
    cpp: "cpp",
    h: "c",
    hpp: "cpp",
    cs: "csharp",
    css: "css",
    scss: "scss",
    less: "less",
    html: "html",
    xml: "xml",
    json: "json",
    yaml: "yaml",
    yml: "yaml",
    md: "markdown",
    sql: "sql",
    sh: "shellscript",
    bash: "shellscript",
    toml: "toml",
    ini: "ini",
    vue: "vue",
    svelte: "svelte",
  };
  return map[ext.toLowerCase()] ?? "plaintext";
}

/**
 * Resolve the workspace-relative path of an SCM resource from a command argument.
 *
 * Accepts either a vscode.Uri directly, or a SourceControlResourceTreeItem-like
 * object exposing `resourceUri` / `sourceUri`.
 *
 * Extracted from reference project extension.ts (lines 1817-1832).
 */
export function getScmResourcePath(arg?: unknown): string | undefined {
  const value = arg as unknown;
  let uri: vscode.Uri | undefined;
  if (value instanceof vscode.Uri) {
    uri = value;
  } else if (value && typeof value === "object") {
    if ("resourceUri" in value) {
      uri = (value as { resourceUri?: vscode.Uri }).resourceUri;
    } else if ("sourceUri" in value) {
      uri = (value as { sourceUri?: vscode.Uri }).sourceUri;
    }
  }
  if (!uri) return undefined;

  return vscode.workspace.asRelativePath(uri, false);
}
