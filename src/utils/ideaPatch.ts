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
 * Parse IDEA patch format to extract base and modified content for a specific file.
 * IDEA patches have:
 * - BaseRevisionTextPatchEP section with <+> containing the original file (escaped)
 * - Standard unified diff section
 *
 * Extracted from reference project extension.ts (lines 1670-1744).
 */
export function parseIdeaPatchForFile(
  patchContent: string,
  filePath: string,
): { baseContent: string; modifiedContent: string } {
  const lines = patchContent.split("\n");
  let inTargetFile = false;
  let inBaseRevision = false;
  let baseContentEscaped = "";
  const diffLines: string[] = [];
  let inDiff = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Detect file section start
    if (line.startsWith("Index: ")) {
      if (inTargetFile) break; // hit next file
      const indexPath = line.substring(7).trim();
      if (indexPath === filePath) {
        inTargetFile = true;
      }
      continue;
    }

    if (!inTargetFile) continue;

    // Detect BaseRevisionTextPatchEP section
    if (
      line.includes(
        "com.intellij.openapi.diff.impl.patch.BaseRevisionTextPatchEP",
      )
    ) {
      inBaseRevision = true;
      continue;
    }

    // Collect base content (starts with <+>)
    if (inBaseRevision && line.startsWith("<+>")) {
      baseContentEscaped = line.substring(3);
      inBaseRevision = false;
      continue;
    }

    // Skip charset info
    if (line.includes("CharsetEP")) {
      // Next line will be <+>UTF-8 or similar, skip it
      if (i + 1 < lines.length && lines[i + 1].startsWith("<+>")) {
        i++;
      }
      continue;
    }

    // Detect diff start
    if (line.startsWith("--- ") && !inDiff) {
      inDiff = true;
      diffLines.push(line);
      continue;
    }

    if (inDiff) {
      diffLines.push(line);
    }
  }

  // Unescape base content (IDEA uses \n for newlines, \t for tabs in the <+> section)
  const baseContent = baseContentEscaped
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\\\/g, "\\");

  // Apply unified diff to base content to get modified content
  const modifiedContent = applyUnifiedDiff(baseContent, diffLines);

  return { baseContent, modifiedContent };
}

/**
 * Apply a unified diff to base content to produce modified content.
 *
 * Extracted from reference project extension.ts (lines 1749-1815).
 */
export function applyUnifiedDiff(
  baseContent: string,
  diffLines: string[],
): string {
  if (diffLines.length === 0) return baseContent;

  const baseLines = baseContent.split("\n");
  const result: string[] = [];
  let baseIdx = 0;

  for (let i = 0; i < diffLines.length; i++) {
    const line = diffLines[i];

    // Parse hunk header: @@ -start,count +start,count @@
    const hunkMatch = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunkMatch) {
      const oldStart = Number.parseInt(hunkMatch[1], 10) - 1; // 0-indexed

      // Copy lines before this hunk
      while (baseIdx < oldStart) {
        result.push(baseLines[baseIdx]);
        baseIdx++;
      }

      // Process hunk lines
      for (let j = i + 1; j < diffLines.length; j++) {
        const hunkLine = diffLines[j];
        if (
          hunkLine.startsWith("@@") ||
          hunkLine.startsWith("diff ") ||
          hunkLine.startsWith("Index: ")
        ) {
          i = j - 1;
          break;
        }
        if (hunkLine.startsWith("-")) {
          // Removed line — skip in base
          baseIdx++;
        } else if (hunkLine.startsWith("+")) {
          // Added line
          result.push(hunkLine.substring(1));
        } else if (hunkLine.startsWith(" ")) {
          // Context line
          result.push(hunkLine.substring(1));
          baseIdx++;
        } else {
          // End of diff or no-newline marker
          if (hunkLine.startsWith("\\ No newline")) continue;
          i = j - 1;
          break;
        }
        if (j === diffLines.length - 1) {
          i = j;
        }
      }
      continue;
    }

    // Skip --- and +++ lines
    if (line.startsWith("--- ") || line.startsWith("+++ ")) continue;
  }

  // Copy remaining base lines
  while (baseIdx < baseLines.length) {
    result.push(baseLines[baseIdx]);
    baseIdx++;
  }

  return result.join("\n");
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
