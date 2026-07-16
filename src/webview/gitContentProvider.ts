import * as vscode from "vscode";
import type { RepoRegistry } from "../git/repoRegistry";

export const GIT_ATLAS_SCHEME = "git-atlas";

/**
 * Provides virtual file content for git file revisions.
 * Uri format: git-atlas:/<filePath>?ref=<commitHash>&repo=<repoPath>
 *
 * `repo` is optional and points at the owning repository root. When present
 * the provider resolves the matching GitService from the registry; otherwise
 * it falls back to the currently-selected repo. This is required for
 * multi-repo workspaces where a single bound GitService cannot serve every
 * diff (the original implementation captured a startup-time snapshot).
 *
 * Implements both TextDocumentContentProvider (for text diff) and
 * FileSystemProvider (for binary files like images).
 */
export class GitContentProvider
  implements vscode.TextDocumentContentProvider, vscode.FileSystemProvider
{
  private _onDidChangeFile = new vscode.EventEmitter<
    vscode.FileChangeEvent[]
  >();
  readonly onDidChangeFile = this._onDidChangeFile.event;

  constructor(private readonly registry: RepoRegistry) {}

  /**
   * Resolve the GitService that owns a virtual document URI.
   *
   * Prefers an explicit `repo` query param (absolute repo root, produced by
   * the handlers that build diff URIs). Falls back to the currently-selected
   * repo so legacy URIs without a `repo` param keep working.
   */
  private resolveGitService(uri: vscode.Uri) {
    const repo = new URLSearchParams(uri.query).get("repo");
    if (repo) {
      const svc = this.registry.getService(repo);
      if (svc) return svc;
    }
    return this.registry.getCurrent();
  }

  // ─── TextDocumentContentProvider ──────────────────────────────────

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const ref = new URLSearchParams(uri.query).get("ref") ?? "";
    const filePath = uri.path.startsWith("/") ? uri.path.slice(1) : uri.path;
    if (!ref || !filePath) {
      return "";
    }
    const gitService = this.resolveGitService(uri);
    if (!gitService) {
      return "";
    }
    return gitService.getFileContent(ref, filePath);
  }

  // ─── FileSystemProvider (for binary files) ────────────────────────

  watch(): vscode.Disposable {
    return new vscode.Disposable(() => {});
  }

  async stat(_uri: vscode.Uri): Promise<vscode.FileStat> {
    return {
      type: vscode.FileType.File,
      ctime: 0,
      mtime: 0,
      size: 0,
    };
  }

  readDirectory(): Thenable<[string, vscode.FileType][]> {
    return Promise.resolve([]);
  }

  createDirectory(): void {}

  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    const ref = new URLSearchParams(uri.query).get("ref") ?? "";
    const filePath = uri.path.startsWith("/") ? uri.path.slice(1) : uri.path;
    if (!ref || !filePath) {
      return new Uint8Array(0);
    }
    const gitService = this.resolveGitService(uri);
    if (!gitService) {
      return new Uint8Array(0);
    }
    const buffer = await gitService.getFileContentBuffer(ref, filePath);
    return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  writeFile(): void {
    throw vscode.FileSystemError.NoPermissions("Read-only git content");
  }

  delete(): void {
    throw vscode.FileSystemError.NoPermissions("Read-only git content");
  }

  rename(): void {
    throw vscode.FileSystemError.NoPermissions("Read-only git content");
  }
}
