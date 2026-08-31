export interface RequestMessage {
  type: "request";
  id: string;
  // 宽化为 string：MessageRouter 是子系统通用的，project/task 的命令名不在
  // git 专属 CommandType union 内。Git 代码仍可传 CommandType（string 子集）。
  command: string;
  params: Record<string, unknown>;
}

export interface ResponseMessage {
  type: "response";
  id: string;
  success: boolean;
  data?: unknown;
  error?: {
    code: ErrorCode;
    message: string;
  };
}

export interface EventMessage {
  type: "event";
  // 宽化为 string：broadcastEvent 面向所有子系统，project/task 的事件名不在
  // git 专属 EventType union 内。Git 代码仍可传 EventType（string 子集）。
  event: string;
  data: unknown;
}

export type Message = RequestMessage | ResponseMessage | EventMessage;

export type CommandType =
  | "getLog"
  | "getGraphData"
  | "loadMoreLog"
  | "getBranches"
  | "getUserIdentity"
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
  | "showFileHistory"
  | "checkoutBranch"
  | "createBranch"
  | "deleteBranch"
  | "renameBranch"
  | "mergeBranch"
  | "rebaseBranch"
  | "checkoutAndRebase"
  | "pushBranch"
  | "pullBranch"
  | "pullRebase"
  | "pullMerge"
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
  | "getRebaseState"
  | "rebaseAction"
  | "mergeAction"
  | "cherryPickAction"
  | "openConflictsPanel"
  | "createBranchPrompt"
  | "deleteBranchPrompt"
  | "fetchAll"
  | "toggleFavorite"
  | "navigateToHead"
  | "locateCommitInLog"
  | "consumePendingFocus"
  | "toggleBranchGroupByDirectory"
  | "setSingleClickAction"
  | "toggleShowTags"
  | "getAheadCommits"
  | "getCommitRangeFiles"
  | "executePush"
  | "openPushPanel"
  | "getRemoteBranches"
  | "dropCommit"
  | "closePushPanel"
  | "openRollbackPanel"
  | "executeRollback"
  | "closeRollbackPanel"
  | "getRepos"
  | "getCurrentRepo"
  | "switchRepo"
  | "getRepoStatuses"
  | "hasRemote"
  | "getRemotes"
  | "addRemote"
  | "removeRemote"
  | "setRemoteUrl"
  | "renameRemote"
  // 在工作区非 git 目录执行 `git init`，返回 { success, repoPath?, error? }。
  | "initializeRepository"
  // 多仓库批量操作（作用于 registry 中所有仓库，而非仅当前仓库）：
  // refreshAllRepos 重新扫描并刷新全部仓库缓存；pullAllRepos 串行 pull 所有
  // 含 remote 的仓库，返回 { pulled, skipped, failed }。
  | "refreshAllRepos"
  | "pullAllRepos"
  | "getL10nBundle"
  | "getGitConfig"
  | "setGitConfig"
  | "getAiConfig"
  | "generateCommitMessage"
  | "cancelCommitMessageGeneration"
  | "setAiApiKey"
  | "openAiSettings"
  | "openGitSettings"
  // 新版本（New Version）— Git Atlas 新版本助手（commit 面板第三个 tab）
  | "getNewVersionContext"
  | "generateNewVersionChangelog"
  | "cancelNewVersionChangelogGeneration"
  | "createNewVersion"
  | "pushNewVersion"
  | "initNewVersionChangelog"
  | "updateNewVersionPrompt"
  | "locateCommit"
  // 远程发布（Release）— GitHub/Gitee 远程 Release 发布（commit 面板第四个 tab）
  | "getRemoteReleaseTargets"
  | "createRelease"
  | "getChangelogEntryForTag"
  | "selectReleaseAttachments"
  | "promptGiteeToken";

export type EventType =
  | "gitStateChanged"
  | "mergeStateChanged"
  | "themeChanged"
  | "showFileHistory"
  | "operationStart"
  | "operationEnd"
  | "commitStateChanged"
  | "rollbackPanelInit"
  | "repoChanged"
  | "reposChanged"
  | "gitConfigChanged"
  | "aiConfigChanged"
  | "focusCommit"
  // commit 面板内部 tab 切换（git-atlas.newVersion 命令 → newVersion tab）
  | "switchTab"
  // Gitee token 写入/清除（release tab 内的 prompt 或命令面板命令）→
  // 已打开的 webview 据此刷新 release targets 的认证状态
  | "giteeTokenChanged";

export interface RemoteBranchGroup {
  remote: string;
  branches: string[];
}

export enum ErrorCode {
  GIT_NOT_FOUND = "GIT_NOT_FOUND",
  GIT_COMMAND_FAILED = "GIT_COMMAND_FAILED",
  NOT_A_GIT_REPO = "NOT_A_GIT_REPO",
  INVALID_REF = "INVALID_REF",
  FILE_NOT_FOUND = "FILE_NOT_FOUND",
  MERGE_CONFLICT = "MERGE_CONFLICT",
  UNKNOWN = "UNKNOWN",
}
