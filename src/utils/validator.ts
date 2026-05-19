import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { randomUUID } from "crypto";

export function isPathValid(p: string): boolean {
  try {
    fs.accessSync(p, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export function generateId(): string {
  return randomUUID();
}

export function getWorkspaceName(): string {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    return "";
  }
  return path.basename(folders[0].uri.fsPath);
}

export function normalizePath(p: string): string {
  return p.replace(/^([a-z]):/, (_, drive) => drive.toUpperCase() + ":");
}

export function getWorkspacePath(): string {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    return "";
  }
  return normalizePath(folders[0].uri.fsPath);
}
