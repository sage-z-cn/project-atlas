export type TaskSource = "vscode" | "npm";

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

export interface TaskItem {
  /**
   * Unique ID:
   * Root:     "vscode::<label>" or "npm::<scriptName>"
   * Sub-proj: "vscode::<relativeDir>::<label>" or "npm::<relativeDir>::<scriptName>"
   */
  id: string;
  /** Display name */
  name: string;
  /** Source type */
  source: TaskSource;
  /** Group name from vscode tasks.json group, or "npm Scripts" for npm */
  group?: string;
  /** Absolute path to the directory containing this task's config file */
  cwd: string;
  /** Relative to workspace root (e.g. "packages/app"). Empty string for root tasks. */
  relativeDir: string;
  /** Detected package manager for npm tasks */
  packageManager: PackageManager;
}
