import type { ProjectItem } from "./project";
import type { GroupItem } from "./group";

export interface ProjectData {
  version: number;
  recentProjects: ProjectItem[];
  favoriteProjects: ProjectItem[];
  groups: GroupItem[];
}
