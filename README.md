<div align="center"><img src="https://raw.githubusercontent.com/sage-z-cn/project-atlas/master/resources/icon.png" width="128" height="128" alt="Project Atlas"></div>

<h1 align="center">Project Atlas</h1>

<p align="center">Auto-record projects, quick access.</p>

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

✅ **Auto-tracking** — Every project you open is recorded automatically. No manual setup needed.

✅ **Quick Access** — Open any project from the sidebar with configurable click behavior (single/double click) and window preference. Keyboard shortcuts for instant access.

✅ **Favorites & Groups** — Star projects for quick access and organize them into named groups with expand/collapse.

✅ **Git Clone** — Clone repositories directly into your workspace from the sidebar.

✅ **Project Type Detection** — Automatically identifies 16+ project types and displays matching devicon icons.

✅ **Project Management** — Rename display names, clean up invalid entries, reveal in file explorer, and right-click for quick actions.

✅ **Reveal Active File** — Adds a button to the built-in file explorer's view title bar to locate the currently open file in the tree (can be toggled in settings).

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
| `projectAtlas.showRevealActiveFile` | `boolean` | `true` | Show 'Reveal Active File' button in the built-in file explorer view title |

## Keyboard Shortcuts

| Shortcut | Action |
| --- | --- |
| `Alt+O` | Open project picker |
| `Ctrl+Alt+O` | Focus Project Atlas sidebar |

## Changelog

See [CHANGELOG.md](https://github.com/sage-z-cn/project-atlas/blob/master/CHANGELOG.md) for release history.

## License

This project is licensed under the [GNU General Public License v3.0](https://github.com/sage-z-cn/project-atlas/blob/master/LICENSE) — free to use, modify, and distribute. Derivative works must also be licensed under GPL 3.0.
