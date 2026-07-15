# Project Atlas - VSCode Extension

One extension shipping **three** feature sets, each with its own subsystem:
- **Project Atlas** — project favorites/groups/recent management (activity bar sidebar)
- **Task Atlas** — aggregates VSCode tasks + npm scripts across the workspace (activity bar sidebar)
- **Git Atlas** — multi-repo git log, commit, merge/diff/conflict editor, push, rollback (bottom panel + activity bar)

All three subsystems render through the **same** React 19 webview app (`webview/`) and communicate over one formal request/response/event protocol (`MessageRouter`).

## Agent Working Rules

- **Never ask whether to compile, package, or install.** The user verifies changes themselves. After making edits, report what changed and the build/lint status you already ran — do not offer to run `npm run build-and-install`, `npm run pack`, or any install step, and do not ask permission to do so.
- **Never question whether the user correctly verified a change.** If a change "doesn't work", take it at face value and investigate the root cause. Do not ask the user to confirm they reloaded / restarted / reinstalled, or imply the failure might be a verification mistake on their end.

## Commands

```bash
npm run compile            # TWO stages: extension bundle (out/extension.js) + webview React app (out/webview/). Run this for any full build.
npm run compile:extension  # root vite build -> out/extension.js ONLY (no webview, no typecheck)
npm run compile:webview    # cd webview && tsc --noEmit && vite build -> out/webview/ ONLY (typechecks webview)
npm run watch              # EXTENSION watch ONLY — run npm run watch:webview in a 2nd terminal for webview
npm run lint               # eslint src — extension only, does NOT lint webview/
npm test                   # vscode-test — see "Tests" below; effectively non-functional
npm run pack               # compile + npx @vscode/vsce package -> .vsix
npm run build-and-install  # node scripts/build-and-install.js: compile + package into build/ + code --install-extension --force
npm run publish            # compile + npx @vscode/vsce publish
```

Build gotchas:
- **Never run root `vite build` in isolation** — root `vite.config.ts` has `emptyOutDir: true` and will wipe `out/` including `out/webview/`. The `compile` script orders the stages (extension first, webview second) so webview output survives. Use `npm run compile`.
- `@vscode/vsce` is **not a declared dependency** — invoked via `npx`, so first `pack`/`publish` may hit the network.
- F5 (`.vscode/launch.json`) runs `compile` as its `preLaunchTask` (the default build task in `tasks.json` is `compile`). It rebuilds both stages on every launch — slower than a watch flow, and the launch config is not wired to the watch task.
- Two different Vite majors coexist: root uses **Vite 8**, `webview/` workspace uses **Vite 7**. Don't assume they share config.

## Type checking

- **Extension code is NOT type-checked by the build.** `compile:extension` runs root `vite build`, which uses esbuild to transpile (types are stripped, never checked). There is no `tsc --noEmit` step for `src/`. The only gate is `npm run lint` (eslint). Type errors in extension code will slip through `compile` — rely on your editor or run lint.
- **Webview code IS type-checked.** `webview/package.json` build script is `tsc --noEmit && vite build`, and `webview/tsconfig.json` is strict (`noUnusedLocals`, `verbatimModuleSyntax`, `erasableSyntaxOnly`).
- Root `tsconfig.json` excludes `webview`, `vite.config.ts`, and `out` — it is not invoked by any npm script anyway.

## Tests

`npm test` is effectively non-functional: `.vscode-test.mjs` globs `out/test/**/*.test.js`, but `compile`/`compile:extension` is a single-entry vite lib build (`src/extension.ts` only) that never emits `out/test/`. The sample `src/test/extension.test.ts` exists but is not compiled. Treat the suite as stub-only; there is **no real coverage**. Quality gates are manual.

## Architecture

### Entry point
`src/extension.ts` `activate()` wires:
- `StorageService`, `ProjectService`, `FavoriteService`, `GroupService` (project data, all via `StorageService`)
- `TaskService` — **independent**: uses `globalState` directly, exposes its own `onDidChange`, NOT routed through `StorageService`
- `setupProject(context, ...)` — Project Atlas assembly (recent + favorites React views, project handlers, event broadcasting)
- `setupTask(context, taskService)` — Task Atlas assembly (React view, task handlers, watchers, view/title commands)
- `setupGit(context)` — Git Atlas assembly (modular, independent of the project/task side)

Note: `extension.ts` still defines `const refreshAll = () => {};` as a **no-op**, retained only to minimize changes to `projectCommands`/`groupCommands` signatures. Do not assume it refreshes anything.

### Key directories
- `src/models/` — `project.ts` (`ProjectItem`, `ProjectType`), `group.ts` (`GroupItem`, supports `parentId` nesting), `storage.ts` (`ProjectData`), `task.ts` (`TaskItem`, `TaskSource`, `PackageManager`)
- `src/services/` — `ProjectService`, `FavoriteService`, `GroupService`, `StorageService`, `taskService.ts`
- `src/setupProject.ts`, `src/setupTask.ts`, `src/git/setupGit.ts` — per-subsystem assembly entry points (router + handlers + ReactViewProvider + event subscriptions)
- `src/commands/` — `projectCommands`, `groupCommands`, `aiCommands`, `gitCommands` + `gitContext.ts`; handler modules live in subfolders `gitHandlers/`, `projectHandlers/`, `taskHandlers/`
- `src/ai/` — `aiCommitService.ts` (OpenAI-compatible commit message generation) + `thinkingProviders.ts` (thinking-model support)
- `src/messages/` — `protocol.ts` (`RequestMessage`/`ResponseMessage`/`EventMessage` + `CommandType`/`EventType` unions + `ErrorCode`), `messageRouter.ts` (the router), `l10nHandler.ts` (serves the l10n bundle to webviews via a `getL10nBundle` request)
- `src/webview/` — **8 files**: `reactHtml.ts` (shared HTML shell for every React webview), `reactViewProvider.ts` (generic provider keyed by `mode`), and Git-specific managers: `gitContentProvider`, `diffEditorManager`, `mergeEditorManager`, `conflictsManager`, `pushPanel`, `rollbackPanel`. The legacy hand-built HTML providers (recent/favorites/tasks) have been removed.
- `src/git/` — Git Atlas core: `gitService`, `repoRegistry`, `repoScanner`, `repoPaths`, `graphLayout`, `cache`, `commitViewBadge`, `types`, `setupGit`
- `src/watchers/` — `gitWatcher.ts` + FileWatchers for `**/.vscode/tasks.json` and `**/package.json` that drive task cache invalidation
- `src/utils/` — `validator`, `opener`, `projectTypeDetector`, `confirm`, `ideaPatch`
- `webview/` — **separate npm workspace** (`"workspaces": ["webview"]`), React 19 + zustand + allotment + shiki + diff/node-diff3 + @tanstack/react-virtual + unplugin-icons (SVG icons via `@iconify/json`). Builds a single non-split JS bundle to `../out/webview/assets/main.js` (no code splitting — CSP nonce only covers the entry script). Webview source is organized by feature: `recent/`, `favorites/`, `tasks/`, `commit/`, `conflicts/`, `push/`, `rollback/`, `panel/`, `shared/`.
- `l10n/` — runtime localization (`bundle.l10n.zh-cn.json`)
- `package.nls.json` / `package.nls.zh-cn.json` — manifest NLS bundles

### Unified webview protocol
**One protocol for all three subsystems** (Project, Task, Git). The previous "legacy ad-hoc `postMessage` for Project/Task + formal protocol for Git" split no longer exists.

- Webview → extension: `RequestMessage { type: "request", id, command, params }` → `MessageRouter` dispatches to a registered handler → `ResponseMessage { type: "response", id, success, data?, error? }`.
- Extension → webview: `messageRouter.broadcastEvent(event, data)` fans out `EventMessage { type: "event", event, data }` to **all** registered webviews.
- `CommandType` / `EventType` unions in `protocol.ts` are git-centric but the router widens `command`/`event` to `string` so project/task command and event names pass through unchanged.
- Entry dispatch: `<div id="root">` carries `data-mode` (e.g. `"recent"`, `"favorites"`, `"tasks"`, `"gitLog"`, `"commitPanel"`) + extra `data-*` attrs; `webview/src/main.tsx` reads `root.dataset.mode` and mounts the matching root component.

### Data flow
Project mutations go through `storage.updateData(updater)` (serialized via an internal promise queue) → `storage.onDidChange` → `setupProject` broadcasts `projectDataChanged` → React recent/favorites views refetch. Window focus and `openMode`/`workbench.list.openMode` config changes are also wired to broadcast events. TaskService does **not** follow this path — it persists to `globalState` independently and emits its own `tasksChanged` events.

### Multi-repo Git support
`RepoRegistry` (`repoScanner.scanRepos`) scans each workspace root + **1 level of direct child directories only** (no recursion — explicit performance contract). Dot-directories and `node_modules`/`.git` are skipped; each repo gets its own `GitService` + `GitWatcher`. "Current repo" is switchable; `GitHandlerContext.gitService` is a getter aliasing `registry.getCurrent()` so handlers follow repo switches.

### Storage
- Key: `projectAtlas.data`, via `vscode.globalState`
- Structure: `{ version, recentProjects[], favoriteProjects[], groups[] }`, current version **2**
- Migration v1 → v2 splits `projects[]` into `recentProjects` + `favoriteProjects`. **Triggered by shape** (absence of `recentProjects`), not a version-bump check.

## Critical Constraints

### Webview HTML & CSP
`src/webview/reactHtml.ts` generates the shared HTML shell. CSP:
`default-src 'none'; style-src ${cspSource} 'unsafe-inline'; font-src ${cspSource}; img-src ${cspSource} data:; script-src 'nonce-${nonce}'`.
- `style-src` deliberately includes `'unsafe-inline'` to allow React inline styles / emotion. This is intentional — do not remove it.
- `script-src` is strict: only the nonce-tagged entry `assets/main.js`. Never add more `<script>` tags or inline handlers.

### Icons (unplugin-icons, not font CSS)
React webviews render icons as **SVG components** via `unplugin-icons` + `@iconify/json` (see `webview/vite.config.ts`, `webview/src/icons.d.ts` declaring `~icons/*`). The extension **does not load codicon/devicon font CSS** into webviews, and `dependencies` in the root manifest is empty by design — `reactHtml.ts` notes `font-src` in the CSP is only a fallback. `projectTypeDetector.ts` still returns `iconSource: "codicon" | "devicon"` + an icon name, but that is now a **data label** the webview maps to an SVG component, not a font class.

### Project Type Detection
`src/utils/projectTypeDetector.ts` — 16 typed configs + `unknown` fallback. Scans **root directory only** (`fs.readdirSync`, no recursion — a header comment explicitly forbids recursive scanning; performance critical). Detection order in `PROJECT_TYPE_CONFIGS` (first match wins): electron → react → vue → typescript → javascript → java → python → cpp → csharp → go → rust → php → ruby → swift → kotlin → dart → unknown (codicon `vscode`). `getProjectTypeIcon()` runs on every project open/add.

### Dual List Sync
When updating a project's type, update **BOTH** `recentProjects` and `favoriteProjects` by path match (`projectService.ts` does this in `recordCurrentWorkspace` and `addProject`).

### Vite externals (extension bundle)
`out/extension.js` is a single CJS bundle. Externals (in root `vite.config.ts`): `vscode`, `/^node:/`, `path`, `fs`, `crypto`, `child_process`, `os`, `stream`, `util`, `zlib`.

## Patterns

### Service Layer (Project data)
```typescript
// All project mutations go through storage.updateData() (serialized queue)
await this.storage.updateData((data) => ({
  ...data,
  recentProjects: data.recentProjects.map(p => /* transform */),
}));
```
TaskService does NOT follow this — it persists to `globalState` independently.

### Webview Communication
```typescript
// Extension -> Webview (broadcast to all registered webviews)
messageRouter.broadcastEvent("projectDataChanged", {});
// Webview -> Extension (formal request/response)
postMessage({ type: "request", id, command: "getRecentProjects", params: {} });
```

### Command Registration
```typescript
// In commands/*.ts — register("commandName", handlerFn)
// Command ID becomes: <namespace>.commandName  (project-atlas.* | task-atlas.* | git-atlas.*)
```

## Common Pitfalls

- **Localization: NLS vs L10n — different systems, do not mix.**
  - `package.json` `%key%` placeholders → **NLS**: `package.nls.json` (English default), `package.nls.zh-cn.json` (Chinese). Command titles, view names, config descriptions belong here.
  - `vscode.l10n.t("string")` runtime strings → **L10n**: `l10n/bundle.l10n.zh-cn.json`. Key is the English source, value is the Chinese translation. Only `zh-cn` exists (no `bundle.l10n.json` — English is the source string). Webviews fetch this bundle at runtime via the `getL10nBundle` request handled by `src/messages/l10nHandler.ts`.
  - **Never** put `command.*` NLS keys in the l10n bundle, and **never** put runtime strings in the NLS files.
- Quality gates are manual only: **no CI, no pre-commit hooks, no formatter**. Run `npm run lint` yourself; there is no webview lint. There is no typecheck gate for extension code (see "Type checking").
- `.codegraph/`, `.opencode/`, `.slim/`, `.docs/`, and `build/` are tooling/build artifacts or internal dirs — not part of the extension runtime. `.vscodeignore` excludes `.docs/`, `AGENTS.md`, source maps, and `**/*.ts` from the packaged `.vsix`.
- README is current (documents `projectAtlas.*` / `taskAtlas.*` / `gitAtlas.*` config namespaces and all features including AI commit). Trust the README and the manifest together.
