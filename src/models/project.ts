export type ProjectType = "python" | "java" | "javascript" | "unknown";

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
