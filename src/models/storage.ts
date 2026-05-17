import type { ProjectItem } from "./project";
import type { GroupItem } from "./group";

export interface ProjectData {
  version: number;
  projects: ProjectItem[];
  groups: GroupItem[];
}
