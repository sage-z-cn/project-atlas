export type TodoScope = "global" | "project";
export type TodoSource = "manual" | "scan";
export type TodoStatus = "pending" | "completed";
export type TodoTag = "TODO" | "FIXME" | "XXX" | "HACK" | "BUG" | "NOTE";
export type TodoPriority = "high" | "medium" | "low";

export interface TodoItemDto {
  id: string;
  source: TodoSource;
  scope?: TodoScope;
  status: TodoStatus;
  text: string;
  tag?: TodoTag;
  priority?: TodoPriority;
  file?: string;
  relativePath?: string;
  line?: number;
  column?: number;
  assignee?: string;
  createdAt?: number;
  completedAt?: number;
  workspaceId?: string;
}

export interface WorkspaceFolderInfo {
  uri: string;
  name: string;
}

export interface TodosDataDto {
  globalManual: TodoItemDto[];
  projectManual: TodoItemDto[];
  scanned: TodoItemDto[];
  workspaceName: string;
  scanning: boolean;
  workspaceFolders: WorkspaceFolderInfo[];
}
