import * as vscode from "vscode";
import * as path from "path";
import * as cp from "child_process";
import { ProjectService } from "../services/projectService";
import { FavoriteService } from "../services/favoriteService";
import { resolveOpenMode, openFolder, openInOS } from "../utils/opener";
import type { ProjectItem } from "../models/project";

type TreeNode = { type: string; item: ProjectItem };

const GIT_URL_RE = /^(https?|git|ssh|file):\/\/|^[\w-]+@[\w.-]+:/;

export function registerProjectCommands(
  context: vscode.ExtensionContext,
  projectService: ProjectService,
  favoriteService: FavoriteService,
  refreshAll: () => void
): void {
  const register = (cmd: string, handler: (...args: any[]) => any) => {
    context.subscriptions.push(
      vscode.commands.registerCommand(`project-explorer.${cmd}`, handler)
    );
  };

  register("openProject", openProjectCmd);
  register("addProject", addProjectCmd);
  register("gitClone", gitCloneCmd);
  register("openInNewWindow", openInNewWindowCmd);
  register("openInCurrentWindow", openInCurrentWindowCmd);
  register("openProjectBySetting", openProjectBySettingCmd);
  register("revealInExplorer", revealInExplorerCmd);
  register("addFavorite", addFavoriteCmd);
  register("removeFavorite", removeFavoriteCmd);
  register("renameProject", renameProjectCmd);
  register("removeProject", removeProjectCmd);
  async function openProjectCmd() {
    const recentMap = new Map<string, ProjectItem>();
    for (const p of projectService.getAll()) {
      if (p.isValid) recentMap.set(p.path, p);
    }
    for (const p of favoriteService.getAll()) {
      if (p.isValid) recentMap.set(p.path, p);
    }
    await pickAndOpenProject([...recentMap.values()]);
  }

  async function addProjectCmd() {
    const newWindow = await resolveOpenMode();
    const folders = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      title: vscode.l10n.t("Select Project Folder"),
    });
    if (!folders || folders.length === 0) {return;}
    const uri = folders[0];
    await projectService.addProject(uri.fsPath);
    refreshAll();
    await openFolder(uri, newWindow);
  }

  async function gitCloneCmd() {
    const url = await vscode.window.showInputBox({
      prompt: vscode.l10n.t("Enter Git repository URL"),
      placeHolder: "https://github.com/...",
    });
    if (!url) {return;}

    if (!GIT_URL_RE.test(url)) {
      vscode.window.showErrorMessage(vscode.l10n.t("Invalid Git repository URL."));
      return;
    }

    const targetFolders = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      title: vscode.l10n.t("Select Clone Target Directory"),
    });
    if (!targetFolders || targetFolders.length === 0) {return;}

    const targetDir = targetFolders[0].fsPath;
    let repoName = path.basename(url.replace(/\/$/, ""), ".git");
    if (!repoName) {
      repoName = "repo";
    }
    repoName = repoName.replace(/\.\./g, "").replace(/[\\/:]/g, "");
    if (!repoName) {
      repoName = "repo";
    }
    const clonePath = path.join(targetDir, repoName);
    if (!clonePath.startsWith(path.resolve(targetDir))) {
      vscode.window.showErrorMessage(vscode.l10n.t("Invalid repository URL."));
      return;
    }

    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: vscode.l10n.t("Cloning {0}...", repoName),
          cancellable: true,
        },
        async (_progress, token) => {
          await new Promise<void>((resolve, reject) => {
            const proc = cp.spawn("git", ["clone", "--", url, clonePath]);
            token.onCancellationRequested(() => proc.kill());
            proc.on("close", (code) =>
              code === 0 ? resolve() : reject(new Error(`git clone failed (exit ${code})`))
            );
            proc.on("error", reject);
          });
        }
      );

      await projectService.addProject(clonePath);
      refreshAll();

      const newWindow = await resolveOpenMode();
      await openFolder(vscode.Uri.file(clonePath), newWindow);
    } catch (err: any) {
      if (err.message !== "cancelled") {
        vscode.window.showErrorMessage(
          vscode.l10n.t("Git clone failed: {0}", err.message)
        );
      }
    }
  }

  function openInNewWindowCmd(node: TreeNode) {
    if (node?.type !== "project" || !node.item) {return;}
    openFolder(vscode.Uri.file(node.item.path), true);
  }

  function openInCurrentWindowCmd(node: TreeNode) {
    if (node?.type !== "project" || !node.item) {return;}
    openFolder(vscode.Uri.file(node.item.path), false);
  }

  async function openProjectBySettingCmd(node: TreeNode) {
    if (node?.type !== "project" || !node.item) {return;}
    const config = vscode.workspace.getConfiguration("projectCompass");
    const mode = config.get<string>("openProjectMode", "ask");

    if (mode === "currentWindow") {
      await openFolder(vscode.Uri.file(node.item.path), false);
    } else if (mode === "newWindow") {
      await openFolder(vscode.Uri.file(node.item.path), true);
    } else {
      try {
        const newWindow = await resolveOpenMode();
        await openFolder(vscode.Uri.file(node.item.path), newWindow);
      } catch { /* cancelled */ }
    }
  }

  function revealInExplorerCmd(node: TreeNode) {
    if (node?.type !== "project" || !node.item) {return;}
    openInOS(vscode.Uri.file(node.item.path));
  }

  async function addFavoriteCmd(node: TreeNode) {
    if (node?.type !== "project" || !node.item) {return;}
    await favoriteService.add({ name: node.item.name, path: node.item.path });
    refreshAll();
  }

  async function removeFavoriteCmd(node: TreeNode) {
    if (node?.type !== "project" || !node.item) {return;}
    await favoriteService.remove(node.item.id);
    refreshAll();
  }

  async function renameProjectCmd(node: TreeNode) {
    if (node?.type !== "project" || !node.item) {return;}
    const newName = await vscode.window.showInputBox({
      prompt: vscode.l10n.t("Rename project"),
      value: node.item.name,
    });
    if (!newName) {return;}
    await projectService.renameProject(node.item.id, newName);
    await favoriteService.rename(node.item.id, newName);
    refreshAll();
  }

  async function removeProjectCmd(node: TreeNode) {
    if (node?.type !== "project" || !node.item) {return;}
    await projectService.removeProject(node.item.id);
    refreshAll();
  }

  async function pickAndOpenProject(projects: ProjectItem[]) {
    if (projects.length === 0) {
      vscode.window.showInformationMessage(vscode.l10n.t("No projects recorded yet."));
      return;
    }

    const picks = projects.map((p) => ({
      label: p.name,
      description: p.path,
      project: p,
    }));

    const selected = await vscode.window.showQuickPick(picks, {
      placeHolder: vscode.l10n.t("Select a project to open..."),
    });

    if (!selected) {return;}

    const newWindow = await resolveOpenMode();
    await openFolder(vscode.Uri.file(selected.project.path), newWindow);
  }
}
