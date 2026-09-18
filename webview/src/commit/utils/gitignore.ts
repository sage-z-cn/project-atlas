import { bridge } from "../../shared/bridge";
import { t } from "../../shared/i18n";
import { useCommitStore } from "../../shared/store/commit-store";

export interface AddToGitignoreResult {
  added: string[];
  skipped: string[];
  gitignorePath?: string;
}

/**
 * Append repo-relative paths to `.gitignore` (repo root). Notifies via toast
 * and relies on host `gitStateChanged` to refresh the working-tree list.
 */
export async function addToGitignore(
  paths: string[],
  mode: "file" | "folder" = "file",
): Promise<void> {
  const unique = [...new Set(paths.filter(Boolean))];
  if (unique.length === 0) return;
  const repoPath = useCommitStore.getState().currentRepoPath;
  try {
    const res = (await bridge.request("addToGitignore", {
      paths: unique,
      mode,
      repoPath,
    })) as AddToGitignoreResult & { success?: boolean; status?: string };

    if (res?.success === false) {
      useCommitStore
        .getState()
        .setCommitError(t("Failed to update .gitignore"));
      return;
    }

    // Host returns a sentinel (no usable repository) instead of a result.
    if (res?.status === "not_git_repo") {
      void bridge.request("showInfoNotification", {
        message: t(
          "No Git repository is available. .gitignore was not updated.",
        ),
      });
      return;
    }

    const added = res?.added?.length ?? 0;
    const skipped = res?.skipped?.length ?? 0;
    if (added === 0 && skipped > 0) {
      void bridge.request("showInfoNotification", {
        message: t("Already in .gitignore"),
      });
    } else if (added > 0) {
      void bridge.request("showInfoNotification", {
        message:
          unique.length === 1
            ? t("Added '{0}' to .gitignore", unique[0])
            : t("Added {0} path(s) to .gitignore", added),
      });
    } else {
      void bridge.request("showInfoNotification", {
        message: t("No changes were made to .gitignore."),
      });
    }
  } catch (err) {
    useCommitStore
      .getState()
      .setCommitError(err instanceof Error ? err.message : String(err));
  }
}

/** Open the repo-root `.gitignore` in the editor (creates it if missing). */
export async function openGitignoreFile(): Promise<void> {
  const repoPath = useCommitStore.getState().currentRepoPath;
  try {
    await bridge.request("openGitignore", { repoPath });
  } catch (err) {
    useCommitStore
      .getState()
      .setCommitError(err instanceof Error ? err.message : String(err));
  }
}

/** Parent directory pattern for a repo-relative file path (`a/b/c.txt` → `a/b/`). */
export function parentDirPattern(filePath: string): string | null {
  const normalized = filePath.replace(/\\/g, "/");
  const idx = normalized.lastIndexOf("/");
  if (idx <= 0) return null;
  return `${normalized.slice(0, idx)}/`;
}
