import * as fs from "fs";
import * as path from "path";
import type { ProjectType } from "../models/project";

export interface ProjectTypeResult {
  type: ProjectType;
  icon: string;
  fileIcon?: string;
}

const PROJECT_TYPE_CONFIGS: Array<{
  type: ProjectType;
  icon: string;
  fileIcon?: string;
  detect: (projectPath: string) => boolean;
}> = [
  {
    type: "java",
    icon: "coffee",
    fileIcon: "java",
    detect: (projectPath: string) => {
      try {
        const files = fs.readdirSync(projectPath);
        return files.some((file) => file.endsWith(".java"));
      } catch {
        return false;
      }
    },
  },
  {
    type: "javascript",
    icon: "json",
    fileIcon: "javascript",
    detect: (projectPath: string) => {
      try {
        const files = fs.readdirSync(projectPath);
        return files.includes("package.json");
      } catch {
        return false;
      }
    },
  },
  {
    type: "python",
    icon: "python",
    fileIcon: "python",
    detect: (projectPath: string) => {
      try {
        const files = fs.readdirSync(projectPath);
        return files.some((file) => file.endsWith(".py"));
      } catch {
        return false;
      }
    },
  },
];

export function detectProjectType(projectPath: string): ProjectTypeResult {
  for (const config of PROJECT_TYPE_CONFIGS) {
    if (config.detect(projectPath)) {
      return { type: config.type, icon: config.icon, fileIcon: config.fileIcon };
    }
  }
  return { type: "unknown", icon: "vscode" };
}

export function getProjectTypeIcon(projectType: ProjectType | undefined): { icon: string; fileIcon?: string } {
  if (!projectType || projectType === "unknown") {
    return { icon: "vscode" };
  }
  const config = PROJECT_TYPE_CONFIGS.find((c) => c.type === projectType);
  return config ? { icon: config.icon, fileIcon: config.fileIcon } : { icon: "vscode" };
}
