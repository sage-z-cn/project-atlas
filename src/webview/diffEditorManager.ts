import * as vscode from "vscode";
import type { RepoRegistry } from "../git/repoRegistry";
import type { DiffFile } from "../git/types";
import { GIT_ATLAS_SCHEME } from "./gitContentProvider";

export class DiffEditorManager {
  /** Current diff navigation state */
  private diffFiles: DiffFile[] = [];
  private diffCommit = "";
  private diffIndex = -1;
  private diffBaseRef?: string;
  private diffCherryPickHashes?: string[];

  constructor(private readonly registry: RepoRegistry) {}

  /** Set the file list for diff navigation */
  setDiffFileList(
    files: DiffFile[],
    commit: string,
    baseRef?: string,
    cherryPickHashes?: string[],
  ): void {
    this.diffFiles = files;
    this.diffCommit = commit;
    this.diffBaseRef = baseRef;
    this.diffCherryPickHashes = cherryPickHashes;
    this.diffIndex = -1;
    // Drive the log-panel next/prev diff toolbar button visibility.
    void vscode.commands.executeCommand(
      "setContext",
      "gitAtlas.hasDiffList",
      files.length > 0,
    );
  }

  /** Set current index (when opening a specific file) */
  setCurrentIndex(index: number): void {
    this.diffIndex = index;
  }

  /** Navigate to next file diff */
  async nextDiff(): Promise<boolean> {
    if (this.diffFiles.length === 0) {
      void vscode.window.setStatusBarMessage(
        "$(info) No file list available. Open a diff from Changed Files first.",
        3000,
      );
      return false;
    }
    this.diffIndex = Math.min(this.diffIndex + 1, this.diffFiles.length - 1);
    await this.openCurrentDiff();
    return true;
  }

  /** Navigate to previous file diff */
  async prevDiff(): Promise<boolean> {
    if (this.diffFiles.length === 0) {
      void vscode.window.setStatusBarMessage(
        "$(info) No file list available. Open a diff from Changed Files first.",
        3000,
      );
      return false;
    }
    this.diffIndex = Math.max(this.diffIndex - 1, 0);
    await this.openCurrentDiff();
    return true;
  }

  private async openCurrentDiff(): Promise<void> {
    const file = this.diffFiles[this.diffIndex];
    if (!file) return;
    const filePath = file.newPath || file.oldPath;

    // Show status message
    const total = this.diffFiles.length;
    const current = this.diffIndex + 1;
    void vscode.window.setStatusBarMessage(
      `$(arrow-right) File ${current}/${total}: ${filePath.split("/").pop()}  —  Press again to go to the next file`,
      5000,
    );

    await this.openDiffEditor(
      this.diffCommit,
      filePath,
      file,
      this.diffBaseRef,
      this.diffCherryPickHashes,
    );
  }

  async openDiffEditor(
    commit: string,
    filePath: string,
    fileMeta?: DiffFile,
    baseRef?: string,
    cherryPickHashes?: string[],
  ): Promise<void> {
    const gitService = this.registry.getCurrent();
    if (!gitService) return;

    const status = fileMeta?.status ?? "modified";
    const oldPath = fileMeta?.oldPath ?? filePath;
    const newPath = fileMeta?.newPath ?? filePath;

    // Determine left (parent) and right (commit) refs
    let leftRef: string;
    let rightRef: string = commit;

    if (cherryPickHashes && cherryPickHashes.length > 1) {
      const range = await gitService.findFileRange(
        cherryPickHashes,
        newPath || oldPath,
      );
      if (range) {
        rightRef = range.newest;
        const parents = await gitService.getCommitParents(range.oldest);
        leftRef = parents[0] ?? "";
      } else {
        const parents = await gitService.getCommitParents(commit);
        leftRef = parents[0] ?? "";
      }
    } else if (baseRef) {
      leftRef = baseRef;
    } else {
      const parents = await gitService.getCommitParents(commit);
      leftRef = parents[0] ?? "";
    }

    // Tag every virtual URI with the owning repo so GitContentProvider resolves
    // the correct GitService (multi-repo safe). Falls back to current repo when
    // no repo is selected.
    const repoPath = this.registry.getCurrentRepoPath();
    const repoQuery = repoPath
      ? `&repo=${encodeURIComponent(repoPath)}`
      : "";

    // Build URIs based on file status
    let leftUri: vscode.Uri;
    let rightUri: vscode.Uri;

    switch (status) {
      case "added":
        leftUri = vscode.Uri.parse(
          `${GIT_ATLAS_SCHEME}:/${newPath}?ref=empty${repoQuery}`,
        );
        rightUri = vscode.Uri.parse(
          `${GIT_ATLAS_SCHEME}:/${newPath}?ref=${rightRef}${repoQuery}`,
        );
        break;
      case "deleted":
        leftUri = vscode.Uri.parse(
          `${GIT_ATLAS_SCHEME}:/${oldPath}?ref=${leftRef}${repoQuery}`,
        );
        rightUri = vscode.Uri.parse(
          `${GIT_ATLAS_SCHEME}:/${oldPath}?ref=empty${repoQuery}`,
        );
        break;
      case "renamed":
      case "copied":
        leftUri = vscode.Uri.parse(
          `${GIT_ATLAS_SCHEME}:/${oldPath}?ref=${leftRef}${repoQuery}`,
        );
        rightUri = vscode.Uri.parse(
          `${GIT_ATLAS_SCHEME}:/${newPath}?ref=${rightRef}${repoQuery}`,
        );
        break;
      default: // modified
        leftUri = vscode.Uri.parse(
          `${GIT_ATLAS_SCHEME}:/${newPath}?ref=${leftRef}${repoQuery}`,
        );
        rightUri = vscode.Uri.parse(
          `${GIT_ATLAS_SCHEME}:/${newPath}?ref=${rightRef}${repoQuery}`,
        );
        break;
    }

    // Build title
    const fileName = filePath.split("/").pop() ?? filePath;
    const shortHash = commit.substring(0, 7);
    const title =
      cherryPickHashes && cherryPickHashes.length > 1
        ? `${fileName} (${cherryPickHashes.length} commits)`
        : baseRef
          ? `${fileName} (${baseRef.substring(0, 7)}..${shortHash})`
          : `${fileName} (${shortHash})`;

    await vscode.commands.executeCommand(
      "vscode.diff",
      leftUri,
      rightUri,
      title,
    );
  }
}
