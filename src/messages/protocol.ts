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
  | "getShelves"
  | "shelveChanges"
  | "unshelveChanges"
  | "deleteShelve"
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
  | "compareWithCurrent"
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
  | "getL10nBundle"
  | "getGitConfig"
  | "setGitConfig"
  | "getAiConfig"
  | "generateCommitMessage"
  | "cancelCommitMessageGeneration"
  | "setAiApiKey"
  | "openAiSettings"
  | "openGitSettings";

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
  | "focusCommit";

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
