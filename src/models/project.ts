export type ProjectType =
  | "python"
  | "java"
  | "javascript"
  | "typescript"
  | "react"
  | "vue"
  | "electron"
  | "cpp"
  | "csharp"
  | "go"
  | "rust"
  | "php"
  | "ruby"
  | "swift"
  | "kotlin"
  | "dart"
  | "unknown";

export interface ProjectItem {
  id: string;
  name: string;
  path: string;
  lastOpenedAt: number;
  groupId?: string;
  order: number;
  isFavorite: boolean;
  isValid: boolean;
  projectType?: ProjectType;
}
