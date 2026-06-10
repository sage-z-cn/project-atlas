export type TaskSource = "vscode" | "npm";

export interface TaskItem {
  /** Unique ID: "vscode::<taskLabel>" or "npm::<scriptName>" */
  id: string;
  /** Display name */
  name: string;
  /** Source type */
  source: TaskSource;
  /** Group name from vscode tasks.json group.isDefault / group._label, or "npm Scripts" for npm */
  group?: string;
}
