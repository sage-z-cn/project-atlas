# Project Atlas - VSCode Extension

One extension shipping **three** feature sets, each with its own subsystem:
- **Project Atlas** — project favorites/groups/recent management (sidebar)
- **Task Atlas** — aggregates VSCode tasks + npm scripts across the workspace (sidebar)
- **Git Atlas** — multi-repo git log, commit, merge/diff/conflict editor, push, rollback (panel + activity bar)

UI for Project/Task Atlas is hand-built HTML injected into webviews; Git Atlas UI is a **separate React 19 app** in the `webview/` npm workspace.

## Commands

```bash
npm run compile          # TWO stages: extension bundle + webview React app (run this, not vite build alone)
npm run compile:extension  # vite build -> out/extension.js only
npm run compile:webview    # cd webview && vite build -> out/webview/ only
npm run watch            # EXTENSION watch ONLY — run npm run watch:webview in a 2nd terminal for webview
npm run lint             # eslint src — does NOT lint the webview/ workspace
npm test                 # vscode-test — runs the stub sample test; no real coverage exists
npm run pack             # compile + npx @vscode/vsce package -> .vsix
npm run build-and-install # compile + package + `code --install-extension --force` (needs `code` CLI on PATH)
npm run publish          # compile + npx @vscode/vsce publish
```

Build gotchas:
- **Never run `vite build` (root) in isolation** — it has `emptyOutDir: true` and will wipe `out/webview/`. The `compile` script orders the stages so webview output survives. Use `npm run compile`.
- `@vscode/vsce` is **not a declared dependency** — invoked via `npx`, so first `pack`/`publish` may hit the network.
- F5 (`.vscode/launch.json`) runs full `compile` as its preLaunchTask on every launch — slower than a watch flow, but the launch config isn't wired to the watch task.
- `pretest` hook compiles the **extension only** + lints; it does not build the webview.

## Architecture

### Entry point
`src/extension.ts` activates services and view providers. `activate()` wires:
- `StorageService`, `ProjectService`, `FavoriteService`, `GroupService` (project data)
- `TaskService` (independent — uses `globalState` directly, exposes its own `onDidChange`, NOT routed through StorageService)
- `recentViewProvider`, `favoritesViewProvider`, `tasksViewProvider`
- `setupGit(context)` at the end — entry to the entire Git Atlas subsystem

### Key directories
- `src/models/` — `project.ts` (`ProjectItem`, `ProjectType`), `group.ts` (`GroupItem`, supports `parentId` nesting), `storage.ts` (`ProjectData`), `task.ts` (`TaskItem`, `TaskSource`, `PackageManager`)
- `src/services/` — `ProjectService`, `FavoriteService`, `GroupService`, `StorageService`, `taskService.ts`
- `src/commands/` — `projectCommands`, `groupCommands`, plus `gitCommands` + `gitHandlers/` and `gitContext.ts`
- `src/webview/` — 12 files. Legacy HTML providers: `baseViewProvider`, `recentViewProvider`, `favoritesViewProvider`, `tasksViewProvider`. Git React layer: `reactViewProvider` (base), `gitHtml`, `gitContentProvider`, `diffEditorManager`, `mergeEditorManager`, `conflictsManager`, `pushPanel`, `rollbackPanel`
- `src/git/` — Git Atlas core: `gitService`, `repoRegistry`, `repoScanner`, `repoPaths`, `graphLayout`, `cache`, `types`, `setupGit`
- `src/watchers/` — `gitWatcher.ts` (and FileWatchers for `**/.vscode/tasks.json` + `**/package.json` drive task cache invalidation)
- `src/messages/` — `messageRouter.ts` + protocol.ts (Git Atlas request/response/event protocol)
- `src/providers/` — **dead legacy TreeDataProvider code, zero imports** — do not reference
- `src/utils/` — `validator`, `opener`, `projectTypeDetector`, `confirm`, `ideaPatch` (git patch util)
- `webview/` — **separate npm workspace** (`"workspaces": ["webview"]`), React 19 + zustand + allotment + shiki + diff/node-diff3 + @tanstack/react-virtual + unplugin-icons. Builds a single non-split JS bundle to `../out/webview/assets/main.js` (no code splitting — CSP nonce only covers the entry script)
- `l10n/` — runtime localization (`bundle.l10n.zh-cn.json`)
- `package.nls.json` / `package.nls.zh-cn.json` — manifest NLS bundles

### Multi-repo Git support
`RepoRegistry` scans workspace root + 1-level subdirs; each repo gets its own `GitService` + `GitWatcher`. "Current repo" is switchable; `GitHandlerContext.gitService` is a getter aliasing `registry.getCurrent()` so handlers follow repo switches.

### Data flow
Two distinct webview protocols coexist — do not mix them:
- **Legacy (Project/Task)**: loose `vscode.postMessage({type, ...})` ad-hoc messages, each provider's `onMessage` handles its own. Project mutations go through `storage.updateData()` (queued) → `storage.onDidChange` → `refreshAll()`.
- **Git React views**: formal request/response/event protocol via `MessageRouter` (`messages/protocol.ts`: `RequestMessage`/`ResponseMessage`/`EventMessage` + `ErrorCode`); `broadcastEvent` fans out to all registered webviews.

### Storage
- Key: `projectAtlas.data`, via `vscode.globalState`
- Structure: `{ version, recentProjects[], favoriteProjects[], groups[] }`, current version **2**
- Migration v1 → v2 splits `projects[]` into `recentProjects` + `favoriteProjects`. **Triggered by shape** (presence of `recentProjects`), not a version-bump check.

## Critical Constraints

### Webview Icons (Dual Icon System)
Webviews load **codicon** and **devicon** via `asWebviewUri` from `node_modules`. They are runtime `dependencies` (not devDependencies) and are explicitly re-included by `.vscodeignore`:
- `@vscode/codicons/dist/codicon.css` — UI elements, folder/action icons
- `devicon/devicon.min.css` — project-type icons (colored glyphs)

Class patterns: devicon → `icon + " colored"`; codicon → `"codicon codicon-" + icon`. Group folders: `codicon codicon-folder` (collapsed) / `codicon codicon-folder-opened` (expanded). Exception: the npm glyph needs an explicit devicon base — `devicon devicon-npm-original-wordmark colored`.

### Project Type Detection
`src/utils/projectTypeDetector.ts` — 16 typed configs + `unknown` fallback. Scans **root directory only** (`fs.readdirSync`, no recursion — a header comment explicitly forbids recursive scanning; performance critical). Detection order in `PROJECT_TYPE_CONFIGS` (first match wins): electron → react → vue → typescript → javascript → java → python → cpp → csharp → go → rust → php → ruby → swift → kotlin → dart → unknown (codicon `vscode`).

`getProjectTypeIcon()` returns `{ type, icon, iconSource: "codicon" | "devicon" }`. Runs on every project open/add.

### Dual List Sync
When updating a project's type, update **BOTH** `recentProjects` and `favoriteProjects` by path match (`projectService.ts` does this in `recordCurrentWorkspace` and `addProject`).

### Vite externals (extension bundle)
`out/extension.js` is a single CJS bundle. Externals: `vscode`, `/^node:/`, `path`, `fs`, `crypto`, `child_process`, `os`, `stream`, `util`, `zlib`.

## Patterns

### Service Layer (Project data)
```typescript
// All project mutations go through storage.updateData()
await this.storage.updateData((data) => ({
  ...data,
  recentProjects: data.recentProjects.map(p => /* transform */),
}));
```
TaskService does NOT follow this — it persists to `globalState` independently.

### Webview Communication (legacy)
```typescript
// Extension -> Webview
this.postMessage({ type: "data", items, clickMode });
// Webview -> Extension
vscode.postMessage({ type: "open", id });
```

### Command Registration
```typescript
// In commands/*.ts — register("commandName", handlerFn)
// Command ID becomes: <namespace>.commandName  (project-atlas.* | task-atlas.* | git-atlas.*)
```

## Common Pitfalls

- Webview HTML must include a nonce on `<script>`/`<link>`/`<style>` tags plus the CSP meta tag (`default-src 'none'; style-src 'nonce-...'; font-src ${cspSource}; script-src 'nonce-...'`). Git views add `${cspSource}` to `style-src`.
- **Avoid inline `style=""` attributes** in webview HTML — CSP blocks them. Prefer JS DOM manipulation (`el.style.x = ...` / `el.classList.add()`). One known exception exists (`style="display:none"` in `tasksViewProvider`); don't add more. Nonce-tagged `<style nonce>` blocks are fine.
- `src/providers/` is dead legacy code with zero imports — do not reference or extend it.
- **Localization: NLS vs L10n — 不同体系，不可混用**
  - `package.json` 中的 `%key%` 占位符 → 使用 **NLS** 体系：`package.nls.json`（英文默认）、`package.nls.zh-cn.json`（中文翻译）。命令标题、视图名、配置描述等都属于此类。
  - 代码中 `vscode.l10n.t("string")` 的运行时字符串 → 使用 **L10n** 体系：`l10n/bundle.l10n.zh-cn.json`。key 是英文原文，value 是中文翻译。注意只有 `zh-cn`，没有 `bundle.l10n.json`（英文即源串）。
  - **严禁**在 l10n bundle 中放入 `command.*` 这类 NLS key，同样也**严禁**在 NLS 文件中放入运行时字符串。
- Quality gates are manual only: **no CI, no pre-commit hooks, no formatter**. Run `npm run lint` yourself; there is no webview lint.
- README is partially stale (documents config as `projectExplorer.*` but manifest uses `projectAtlas.*`/`taskAtlas.*`; Git Atlas undocumented). Trust the manifest over the README.
