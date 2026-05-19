import * as fs from "fs";
import * as path from "path";
import type { ProjectType } from "../models/project";

/**
 * Project type detection based on root directory files only.
 * IMPORTANT: Do NOT add recursive directory scanning - it causes performance issues.
 * Detection relies on:
 *   - Build files (pom.xml, build.gradle, Cargo.toml, etc.)
 *   - Config files (tsconfig.json, package.json, etc.)
 *   - Source files in root directory only (.java, .py, .rs, etc.)
 */

export interface ProjectTypeResult {
  type: ProjectType;
  icon: string;
  iconSource: "codicon" | "devicon";
}

const PROJECT_TYPE_CONFIGS: Array<{
  type: ProjectType;
  icon: string;
  iconSource: "codicon" | "devicon";
  detect: (projectPath: string) => boolean;
}> = [
  {
    type: "electron",
    icon: "devicon-electron-original",
    iconSource: "devicon",
    detect: (projectPath: string) => {
      try {
        if (!fs.readdirSync(projectPath).includes("package.json")) {
          return false;
        }
        const pkg = JSON.parse(fs.readFileSync(path.join(projectPath, "package.json"), "utf-8"));
        return !!(pkg.dependencies?.electron || pkg.devDependencies?.electron);
      } catch {
        return false;
      }
    },
  },
  {
    type: "react",
    icon: "devicon-react-original",
    iconSource: "devicon",
    detect: (projectPath: string) => {
      try {
        const files = fs.readdirSync(projectPath);
        if (files.some((f) => f.endsWith(".jsx") || f.endsWith(".tsx"))) {
          return true;
        }
        if (files.includes("package.json")) {
          const pkg = JSON.parse(fs.readFileSync(path.join(projectPath, "package.json"), "utf-8"));
          return !!(pkg.dependencies?.react || pkg.devDependencies?.react);
        }
        return false;
      } catch {
        return false;
      }
    },
  },
  {
    type: "vue",
    icon: "devicon-vuejs-plain",
    iconSource: "devicon",
    detect: (projectPath: string) => {
      try {
        const files = fs.readdirSync(projectPath);
        if (files.some((f) => f.endsWith(".vue"))) {
          return true;
        }
        if (files.includes("package.json")) {
          const pkg = JSON.parse(fs.readFileSync(path.join(projectPath, "package.json"), "utf-8"));
          return !!(pkg.dependencies?.vue || pkg.devDependencies?.vue);
        }
        return false;
      } catch {
        return false;
      }
    },
  },
  {
    type: "typescript",
    icon: "devicon-typescript-plain",
    iconSource: "devicon",
    detect: (projectPath: string) => {
      try {
        const files = fs.readdirSync(projectPath);
        if (files.includes("tsconfig.json")) {
          return true;
        }
        return files.some((f) => f.endsWith(".ts") || f.endsWith(".tsx"));
      } catch {
        return false;
      }
    },
  },
  {
    type: "javascript",
    icon: "devicon-javascript-plain",
    iconSource: "devicon",
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
    type: "java",
    icon: "devicon-java-plain",
    iconSource: "devicon",
    detect: (projectPath: string) => {
      try {
        const files = fs.readdirSync(projectPath);
        if (files.includes("pom.xml") || files.some(f => f.startsWith("build.gradle"))) {
          return true;
        }
        return files.some((f) => f.endsWith(".java"));
      } catch {
        return false;
      }
    },
  },
  {
    type: "python",
    icon: "devicon-python-plain",
    iconSource: "devicon",
    detect: (projectPath: string) => {
      try {
        const files = fs.readdirSync(projectPath);
        return files.some((f) => f.endsWith(".py"));
      } catch {
        return false;
      }
    },
  },
  {
    type: "cpp",
    icon: "devicon-cplusplus-plain",
    iconSource: "devicon",
    detect: (projectPath: string) => {
      try {
        const files = fs.readdirSync(projectPath);
        if (files.some((f) => f.endsWith(".cpp") || f.endsWith(".cxx") || f.endsWith(".cc"))) {
          return true;
        }
        return files.includes("CMakeLists.txt") || files.some((f) => f.endsWith(".h") || f.endsWith(".hpp"));
      } catch {
        return false;
      }
    },
  },
  {
    type: "csharp",
    icon: "devicon-csharp-plain",
    iconSource: "devicon",
    detect: (projectPath: string) => {
      try {
        const files = fs.readdirSync(projectPath);
        return files.some((f) => f.endsWith(".csproj") || f.endsWith(".sln") || f.endsWith(".cs"));
      } catch {
        return false;
      }
    },
  },
  {
    type: "go",
    icon: "devicon-go-plain",
    iconSource: "devicon",
    detect: (projectPath: string) => {
      try {
        const files = fs.readdirSync(projectPath);
        return files.includes("go.mod") || files.some((f) => f.endsWith(".go"));
      } catch {
        return false;
      }
    },
  },
  {
    type: "rust",
    icon: "devicon-rust-original",
    iconSource: "devicon",
    detect: (projectPath: string) => {
      try {
        const files = fs.readdirSync(projectPath);
        return files.includes("Cargo.toml") || files.some((f) => f.endsWith(".rs"));
      } catch {
        return false;
      }
    },
  },
  {
    type: "php",
    icon: "devicon-php-plain",
    iconSource: "devicon",
    detect: (projectPath: string) => {
      try {
        const files = fs.readdirSync(projectPath);
        return files.includes("composer.json") || files.some((f) => f.endsWith(".php"));
      } catch {
        return false;
      }
    },
  },
  {
    type: "ruby",
    icon: "devicon-ruby-plain",
    iconSource: "devicon",
    detect: (projectPath: string) => {
      try {
        const files = fs.readdirSync(projectPath);
        return files.includes("Gemfile") || files.some((f) => f.endsWith(".rb"));
      } catch {
        return false;
      }
    },
  },
  {
    type: "swift",
    icon: "devicon-swift-plain",
    iconSource: "devicon",
    detect: (projectPath: string) => {
      try {
        const files = fs.readdirSync(projectPath);
        return files.includes("Package.swift") || files.some((f) => f.endsWith(".swift"));
      } catch {
        return false;
      }
    },
  },
  {
    type: "kotlin",
    icon: "devicon-kotlin-plain",
    iconSource: "devicon",
    detect: (projectPath: string) => {
      try {
        const files = fs.readdirSync(projectPath);
        return files.some((f) => f.endsWith(".kt") || f.endsWith(".kts"));
      } catch {
        return false;
      }
    },
  },
  {
    type: "dart",
    icon: "devicon-dart-plain",
    iconSource: "devicon",
    detect: (projectPath: string) => {
      try {
        const files = fs.readdirSync(projectPath);
        return files.includes("pubspec.yaml") || files.some((f) => f.endsWith(".dart"));
      } catch {
        return false;
      }
    },
  },
];

export function detectProjectType(projectPath: string): ProjectTypeResult {
  for (const config of PROJECT_TYPE_CONFIGS) {
    if (config.detect(projectPath)) {
      return { type: config.type, icon: config.icon, iconSource: config.iconSource };
    }
  }
  return { type: "unknown", icon: "vscode", iconSource: "codicon" };
}

export function getProjectTypeIcon(projectType: ProjectType | undefined): ProjectTypeResult {
  if (!projectType || projectType === "unknown") {
    return { type: "unknown", icon: "vscode", iconSource: "codicon" };
  }
  const config = PROJECT_TYPE_CONFIGS.find((c) => c.type === projectType);
  return config
    ? { type: config.type, icon: config.icon, iconSource: config.iconSource }
    : { type: "unknown", icon: "vscode", iconSource: "codicon" };
}
