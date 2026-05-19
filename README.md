<div align="center"><img src="https://raw.githubusercontent.com/sage-z-cn/project-atlas/master/resources/icon.png" width="128" height="128" alt="Project Atlas"></div>

<h1 align="center">Project Atlas</h1>

<p align="center">Auto-record projects, one-click switch.</p>

<p align="center">
  <a href="https://github.com/sage-z-cn/project-atlas.git"><img src="https://img.shields.io/github/stars/sage-z-cn/project-atlas" alt="GitHub Stars"></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-GPL--3.0-blue.svg" alt="GPL 3.0 License">
  <img src="https://img.shields.io/badge/VS%20Code-%5E1.120.0-green.svg" alt="VS Code ^1.120.0">
</p>

<p align="center">
  <a href="https://github.com/sage-z-cn/project-atlas/blob/master/README.md">English</a> | <a href="https://github.com/sage-z-cn/project-atlas/blob/master/README.zh-cn.md">中文文档</a>
</p>

---

<p align="center">
  <img src="https://raw.githubusercontent.com/sage-z-cn/project-atlas/master/screenshot/screenshot-en.png" alt="Project Atlas Sidebar">
</p>

## Features

✅ **Auto-tracking** — Every project you open is recorded automatically with timestamps. No manual setup needed.

✅ **One-click Switch** — Open any project directly from the sidebar. No more digging through file dialogs.

✅ **Favorites** — Star projects for quick access. Add the current workspace to favorites with a single click.

✅ **Groups** — Organize favorites into named groups. Expand or collapse all groups at once to keep things tidy.

✅ **Git Clone** — Clone repositories directly into your workspace from the sidebar, without leaving VS Code.

✅ **Project Type Detection** — Automatically detects 16+ project types (Java, Python, JavaScript, TypeScript, React, Vue, Electron, Go, Rust, C++, C#, PHP, Ruby, Swift, Kotlin, Dart) and displays matching devicon icons.

✅ **Flexible Open Mode** — Choose between single click, double click, or follow your IDE's default setting.

✅ **Open in New/Current Window** — Pick where a project opens on each click, or set a default behavior in settings.

✅ **Clean Invalid Projects** — Remove projects whose folders no longer exist on disk with one click.

✅ **Context Menu** — Right-click any project for quick actions: open, rename, remove, add/remove favorites, reveal in file explorer.

✅ **Rename Projects** — Set a custom display name for any project. The actual folder stays unchanged.

✅ **Keyboard Shortcuts** — Press `Alt+O` to open the project picker, `Ctrl+Alt+O` to focus the sidebar.

✅ **i18n** — Full localization support for English and Chinese interfaces.

## Usage

The extension adds two views to the VS Code sidebar under the **Project Atlas** icon:

**Recent** — Shows recently opened projects, sorted by last access time. Use the toolbar to add a project manually or clone a Git repository. The overflow menu lets you clean up invalid entries and open settings.

**Favorites** — Displays starred projects, optionally organized into groups. Use the toolbar to add the current workspace, create groups, and expand or collapse all groups.

Click any project to open it. Right-click for more options like renaming, toggling favorites, or opening in a new window.

## Configuration

| Setting | Type | Default | Description |
| --- | --- | --- | --- |
| `projectExplorer.recentProjectsLimit` | `number` | `50` | Maximum number of recent projects to keep |
| `projectExplorer.openProjectMode` | `ask` / `currentWindow` / `newWindow` | `ask` | Default window behavior when opening a project |
| `projectExplorer.openMode` | `singleClick` / `doubleClick` / `followIDE` | `followIDE` | How a click on a project item opens it |

## Keyboard Shortcuts

| Shortcut | Action |
| --- | --- |
| `Alt+O` | Open project picker |
| `Ctrl+Alt+O` | Focus Project Atlas sidebar |

## License

This project is licensed under the [GNU General Public License v3.0](https://github.com/sage-z-cn/project-atlas/blob/master/LICENSE) — free to use, modify, and distribute. Derivative works must also be licensed under GPL 3.0.
