import * as path from "node:path";
import * as vscode from "vscode";

/**
 * Normalize a filesystem path so that RepoRegistry can reliably match it
 * across scanner insertion, getService lookups, and setCurrent queries.
 *
 * Uses `vscode.Uri.file(path.resolve(p)).fsPath` so that:
 *  - relative paths are resolved to absolute,
 *  - platform separators are canonicalized (backslashes → forward on Windows fsPath),
 *  - Windows drive-letter casing is normalized (Uri.file uppercases the drive letter),
 *  - redundant `.` / `..` segments are collapsed.
 *
 * Without this single normalization point, getService could silently miss a
 * repo (e.g. "C:\\repo" vs "c:\\repo") and fall back to the wrong service,
 * which is a data-safety class bug.
 */
export function normalizePath(p: string): string {
  return vscode.Uri.file(path.resolve(p)).fsPath;
}
