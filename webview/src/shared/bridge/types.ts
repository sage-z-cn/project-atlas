export interface RequestMessage {
  type: "request";
  id: string;
  command: string;
  params: Record<string, unknown>;
}

export interface ResponseMessage {
  type: "response";
  id: string;
  success: boolean;
  data?: unknown;
  error?: { code: string; message: string };
}

export interface EventMessage {
  type: "event";
  event: string;
  data: unknown;
}

export type Message = RequestMessage | ResponseMessage | EventMessage;

export type CommandType =
  | "getLog"
  | "getGraphData"
  | "loadMoreLog"
  | "getBranches"
  | "getTags"
  | "getDiff"
  | "getFileContent"
  | "getCommitFiles"
  | "getStatus"
  | "openDiffEditor"
  | "openMergeEditor"
  | "getMergeState"
  | "getCherryPickState"
  | "getConflictFiles"
  | "getFileVersions"
  | "saveMergedContent"
  | "stageFile"
  | "unstageFile"
  | "stageAll"
  | "unstageAll"
  | "stageFiles"
  | "unstageFiles"
  | "acceptOurs"
  | "acceptTheirs"
  | "confirmCancelMerge"
  | "closeMergeEditor"
  | "openFile"
  | "openExternalUrl"
  | "checkoutBranch"
  | "createBranch"
  | "createBranchFromCommit"
  | "deleteBranch"
  | "renameBranch"
  | "mergeBranch"
  | "rebaseBranch"
  | "checkoutAndRebase"
  | "pushBranch"
  | "pullBranch"
  | "pullRebase"
  | "pullMerge"
  | "pullAllRepos"
  | "fetchBranch"
  | "commitChanges"
  | "commitAndPush"
  | "amendCommit"
  | "rollbackFile"
  | "rollbackFiles"
  | "getWorkingTreeChanges"
  | "getStashes"
  | "stashChanges"
  | "unstashChanges"
  | "deleteStash"
  | "showStashFileDiff"
  | "unstashFile"
  | "showDiffForWorkingFile"
  | "getAmendMessage"
  | "getCommitDraft"
  | "saveCommitDraft"
  | "deleteFiles"
  | "revealInSystemExplorer"
  | "revealInExplorer"
  | "openInTerminal"
  | "getRecentCommitMessages"
  | "refreshGitState"
  | "refreshAllRepos"
  | "initializeRepository"
  | "getRebaseState"
  | "rebaseAction"
  | "mergeAction"
  | "cherryPickAction"
  | "showErrorNotification"
  | "showInfoNotification"
  | "openConflictsPanel"
  | "createBranchPrompt"
  | "deleteBranchPrompt"
  | "fetchAll"
  | "toggleFavorite"
  | "navigateToHead"
  | "toggleBranchGroupByDirectory"
  | "setSingleClickAction"
  | "toggleShowTags"
  | "getAheadCommits"
  | "getCommitRangeFiles"
  | "executePush"
  | "openPushPanel"
  | "getRemoteBranches"
  | "getRemoteUrl"
  | "deleteTag"
  | "pushTag"
  | "dropCommit"
  | "closePushPanel"
  | "openRollbackPanel"
  | "executeRollback"
  | "closeRollbackPanel"
  | "getGitConfig"
  | "setGitConfig"
  | "getAiConfig"
  | "generateCommitMessage"
  | "cancelCommitMessageGeneration"
  | "setAiApiKey"
  | "openAiSettings"
  | "openGitSettings"
  | "getNewVersionContext"
  | "generateNewVersionChangelog"
  | "cancelNewVersionChangelogGeneration"
  | "createNewVersion"
  | "pushNewVersion"
  | "initNewVersionChangelog"
  | "updateNewVersionPrompt"
  | "locateCommit"
  | "getRemoteReleaseTargets"
  | "createRelease"
  | "getChangelogEntryForTag"
  | "selectReleaseAttachments"
  | "promptGiteeToken";

/* ─── Stash protocol contracts (mirrored by the extension side) ────────── */

export interface StashEntry {
  /** Display-only stash@{n} ref — reindexes on every list mutation. */
  id: string;
  /** Full stash commit SHA — the stable ref for all stash operations. */
  sha: string;
  message: string;
  date: string;
  branch: string;
  files: string[];
}

export type GetStashesResult = StashEntry[];

export type StashChangesParams = {
  /** Undefined/empty → host falls back to English "Stashed changes". */
  message?: string;
  filePaths?: string[];
  repoPath: string | null;
};

export type UnstashChangesParams = {
  /** StashEntry.sha (NOT stash@{n}). */
  stashRef: string;
  drop: boolean;
  repoPath: string | null;
};

export type DeleteStashParams = {
  stashRef: string;
  repoPath: string | null;
};

export type ShowStashFileDiffParams = {
  stashRef: string;
  filePath: string;
  repoPath: string | null;
};

export type UnstashFileParams = {
  stashRef: string;
  filePath: string;
  repoPath: string | null;
};

export interface Bridge {
  request<T = unknown>(
    command: CommandType | string,
    params?: Record<string, unknown>,
    options?: { timeout?: number },
  ): Promise<T>;
  onEvent(handler: (event: string, data: unknown) => void): () => void;
  /**
   * Webview persisted state. VSCode serializes this and restores it via
   * getState() when the webview is recreated (panel reopened / VSCode
   * restarted). Used for UI layout that should survive across sessions.
   */
  getState(): unknown;
  setState(state: unknown): void;
}
