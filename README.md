# Project Explorer

A VS Code extension that automatically records opened projects and enables one-click switching with sidebar tree view, group management, and drag-and-drop reordering.

[中文文档](README.zh-cn.md)

## Features

- **Auto Record** — Automatically records projects when you open them in VS Code
- **Quick Switch** — Switch between projects via the sidebar or `Alt+O` QuickPick
- **Group Management** — Organize projects into nested groups with drag-and-drop
- **Recent Projects** — Virtual group showing recently opened projects
- **Favorites** — Pin frequently used projects to a separate view
- **Git Clone** — Clone a repository and open it directly from the sidebar
- **i18n** — Supports English and Chinese

## Commands

| Command | Description |
|---------|-------------|
| `Alt+O` | Quick open project |
| Open Project | Select folder and open |
| Add Project | Add project to list |
| Git Clone | Clone repo and open |
| New Group | Create a project group |
| Clean Invalid | Remove projects with missing paths |

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `projectExplorer.recentProjectsLimit` | `20` | Max recent projects to display |
| `projectExplorer.showRecentGroup` | `true` | Show recent projects group |
| `projectExplorer.openProjectMode` | `"ask"` | How to open projects: ask / currentWindow / newWindow |

## License

MIT
