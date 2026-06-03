# Project Atlas - VSCode Extension

## Quick Reference

```bash
npm run compile    # Build with Vite (outputs to out/extension.js, single CJS bundle)
npm run watch      # Build + watch mode
npm run lint       # ESLint check (eslint src)
npm run pack       # Build + package as .vsix
npm test           # Run vscode-test (requires compile first — pretest hook does this)
```

## Architecture

VSCode extension for project management with sidebar webview UI.

### Entry Point
- `src/extension.ts` — Extension activation, service wiring

### Key Directories
- `src/models/` — Data interfaces (`ProjectItem`, `GroupItem`, `ProjectData`)
- `src/services/` — Business logic (`ProjectService`, `FavoriteService`, `GroupService`, `StorageService`)
- `src/commands/` — Command handlers (`projectCommands`, `groupCommands`)
- `src/webview/` — Webview view providers (`baseViewProvider`, `recentViewProvider`, `favoritesViewProvider`)
- `src/providers/` — **Unused** TreeDataProvider classes (legacy; views are webview-based)
- `src/utils/` — Helpers (`validator`, `opener`, `projectTypeDetector`, `confirm`)
- `l10n/` — Runtime localization bundle (`bundle.l10n.zh-cn.json`)

### Data Flow
1. `StorageService` persists data via `vscode.globalState`
2. Services mutate data through `storage.updateData()` (queued, event-driven)
3. Webview providers receive data via `postMessage()`
4. UI refreshes triggered by `storage.onDidChange` event

### Storage
- Key: `projectAtlas.data`
- Structure: `{ version, recentProjects[], favoriteProjects[], groups[] }`
- Migration: v1 → v2 splits `projects[]` into `recentProjects` + `favoriteProjects`

## Critical Constraints

### Webview Icons (Dual Icon System)
Webview uses both **codicon** and **devicon** icon fonts, loaded via `asWebviewUri` from `node_modules`:
- `@vscode/codicons/dist/codicon.css` — for UI elements, folder icons, action buttons
- `devicon/devicon.min.css` — for project type icons (colored devicon glyphs)

Usage in JS: devicon → `icon + " colored"` class; codicon → `"codicon codicon-" + icon` class.
Group icons: `codicon codicon-folder` (collapsed), `codicon codicon-folder-opened` (expanded).

### Project Type Detection
Detects 16 types by scanning **root directory only** (no recursion — performance critical). Detection order in `PROJECT_TYPE_CONFIGS` array (first match wins): electron → react → vue → typescript → javascript → java → python → cpp → csharp → go → rust → php → ruby → swift → kotlin → dart → unknown (fallback, codicon `vscode`).

`getProjectTypeIcon()` returns `{ type: ProjectType, icon: string, iconSource: "codicon" | "devicon" }`.

Detection runs on every project open/add, updates both recent and favorites lists.

### Dual List Sync
When updating project type, must update BOTH `recentProjects` and `favoriteProjects` by path match.

## Patterns

### Service Layer
```typescript
// All mutations go through storage.updateData()
await this.storage.updateData((data) => ({
  ...data,
  recentProjects: data.recentProjects.map(p => /* transform */),
}));
```

### Webview Communication
```typescript
// Extension → Webview
this.postMessage({ type: "data", items, clickMode });

// Webview → Extension
vscode.postMessage({ type: "open", id });
```

### Command Registration
```typescript
// In commands/*.ts
register("commandName", handlerFn);
// Command ID becomes: project-atlas.commandName
```

## Common Pitfalls

- Webview HTML must include nonce for CSP compliance
- `src/providers/` is unused legacy code — do not reference it
- **No inline styles in webview** — CSP blocks `style=""` attributes. Use JS DOM manipulation: `el.style.property = value` or `el.classList.add()`
- **Localization: NLS vs L10n — 不同体系，不可混用**
  - `package.json` 中的 `%key%` 占位符 → 使用 **NLS** 体系：`package.nls.json`（英文默认）、`package.nls.zh-cn.json`（中文翻译）。命令标题、视图名、配置描述等都属于此类。
  - 代码中 `vscode.l10n.t("string")` 的运行时字符串 → 使用 **L10n** 体系：`l10n/bundle.l10n.zh-cn.json`。key 是英文原文，value 是中文翻译。
  - **严禁**在 l10n bundle 中放入 `command.*` 这类 NLS key，同样也**严禁**在 NLS 文件中放入运行时字符串。
- Vite builds a single CJS bundle (`out/extension.js`) — not individual files. Externalizes `vscode`, `path`, `fs`, `crypto`, `child_process`
