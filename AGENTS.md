# Project Atlas - VSCode Extension

## Quick Reference

```bash
npm run compile    # Build with Vite (outputs to out/)
npm run watch      # Build + watch mode
npm run lint       # ESLint check
npm test           # Run vscode-test
```

## Architecture

VSCode extension for project management with sidebar webview UI.

### Entry Point
- `src/extension.ts` - Extension activation, service wiring

### Key Directories
- `src/models/` - Data interfaces (ProjectItem, GroupItem, ProjectData)
- `src/services/` - Business logic (ProjectService, FavoriteService, GroupService, StorageService)
- `src/commands/` - Command handlers (projectCommands, groupCommands)
- `src/webview/` - Webview view providers (recentViewProvider, favoritesViewProvider)
- `src/utils/` - Helpers (validator, opener, projectTypeDetector)

### Data Flow
1. StorageService persists data via `vscode.globalState`
2. Services mutate data through `storage.updateData()` (queued, event-driven)
3. Webview providers receive data via `postMessage()`
4. UI refreshes triggered by `storage.onDidChange` event

### Storage
- Key: `projectExplorer.data`
- Structure: `{ version, recentProjects[], favoriteProjects[], groups[] }`
- Migration: v1 → v2 splits `projects[]` into `recentProjects` + `favoriteProjects`

## Critical Constraints

### Webview Icons
- **Only Codicons work** in webview (CSS security policy blocks file icon themes)
- Valid icons: `codicon codicon-{name}` (e.g., `codicon codicon-python`)
- Group folder: `folder` (collapsed), `folder-opened` (expanded)
- See `src/utils/projectTypeDetector.ts` for icon mapping

### Project Type Detection
Priority order (first match wins):
1. Java: `.java` files → icon `coffee`
2. JavaScript: `package.json` → icon `json`
3. Python: `.py` files → icon `python`
4. Unknown: fallback → icon `vscode`

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
- `getProjectTypeIcon()` returns `{ icon, fileIcon? }` object, not string
- TreeDataProvider unused in favor of webview-based views
- L10n strings in `l10n/bundle.l10n.zh-cn.json`
- **No inline styles in webview** - CSP blocks `style=""` attributes. Use JS DOM manipulation: `el.style.property = value` or `el.classList.add()`
