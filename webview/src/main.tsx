import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { CommitApp } from "./commit/App";
import { ConflictsApp } from "./conflicts/App";
import { MergeStandaloneApp } from "./conflicts/MergeStandaloneApp";
import { FavoritesApp } from "./favorites/App";
import { PanelApp } from "./panel/App";
import { PushApp } from "./push/App";
import { RecentApp } from "./recent/App";
import { RollbackApp } from "./rollback/App";
import { TasksApp } from "./tasks/App";
import { initI18n } from "./shared/i18n";
import "./shared/theme/variables.css";

// Fix Cmd+A/Ctrl+A not working in webview inputs (VS Code intercepts it)
document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "a") {
    const target = e.target as HTMLElement;
    if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
      e.stopPropagation();
      (target as HTMLInputElement).select();
    }
  }
});

// Load the i18n bundle BEFORE first render so components see translated
// strings on their initial paint (no English flash under a non-English locale).
// .finally() ensures the webview still renders if the bridge round-trip fails
// — initI18n swallows errors internally and falls back to English keys.
initI18n().finally(() => {
  const root = document.getElementById("root");
  if (!root) throw new Error("Root element not found");
  const mode = root.dataset.mode as
    | "panel"
    | "merge"
    | "conflicts"
    | "commit"
    | "push"
    | "rollback"
    | "recent"
    | "tasks"
    | "favorites"
    | undefined;

  createRoot(root).render(
    <StrictMode>
      {mode === "merge" ? (
        <MergeStandaloneApp />
      ) : mode === "conflicts" ? (
        <ConflictsApp />
      ) : mode === "commit" ? (
        <CommitApp />
      ) : mode === "push" ? (
        <PushApp />
      ) : mode === "rollback" ? (
        <RollbackApp />
      ) : mode === "recent" ? (
        <RecentApp />
      ) : mode === "tasks" ? (
        <TasksApp />
      ) : mode === "favorites" ? (
        <FavoritesApp />
      ) : (
        <PanelApp />
      )}
    </StrictMode>,
  );
});
