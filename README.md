<div align="center"><img src="https://raw.githubusercontent.com/sage-z-cn/project-atlas/master/resources/icon.png" width="128" height="128" alt="Project Atlas"></div>

<h1 align="center">Project Atlas</h1>

<p align="center">Auto-record projects, quick access, task runner, and JetBrains-style Git integration.</p>

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

## Features

### Project Atlas

**Auto-tracking**
> Every project you open is recorded automatically. No manual setup needed.

**Quick Access**
> Open any project from the sidebar with configurable click behavior (single/double click) and window preference. Keyboard shortcuts for instant access.

**Favorites & Groups**
> Star projects for quick access and organize them into named groups with expand/collapse. Drag to reorder favorites.

**Git Clone**
> Clone repositories directly into your workspace from the sidebar.

**Project Type Detection**
> Automatically identifies 16+ project types and displays matching devicon icons.

**Project Management**
> Rename display names, clean up invalid entries, reveal in file explorer, and right-click for quick actions.

**Reveal Active File**
> Adds a button to the built-in file explorer's view title bar to locate the currently open file in the tree (can be toggled in settings).

### Task Atlas

**Task Runner**
> A dedicated sidebar for running tasks defined in `.vscode/tasks.json` and npm scripts from `package.json`. Start, stop, pin, and drag to reorder tasks with real-time status. Tasks are grouped by project and auto-refreshed when config files change.

### Git Atlas

**Visual Git Log**
> A bottom-panel commit graph with self-rendered SVG lane layout, branch tree (local/remote/tags), collapsible commit sequences, and a detail panel with changed-file tree. Filter by branch, author, date range, or file.

**IDEA-style Commit Panel**
> An activity-bar commit panel with Changes / Staged / Unversioned groups, directory tree, amend, recent commit messages, and commit-and-push split button. Includes git stash (Shelf) and IDEA-compatible shelf (`.idea/shelf/`) with patch import/export.
123
**Multi-repo Support**
> Workspaces with sub-directory git repos get a repo selector in both the Git Log and Commit views. Switch the active repo with one click; status badges (↑ahead / ↓behind / ●uncommitted) update in real time.

**Branch Operations**
> Checkout, create, rename, delete (with force-delete and merge checks), merge, rebase (including checkout-and-rebase), and compare with current — all from the branch tree context menu.

**Commit Operations**
> Cherry-pick, revert, reset (soft/mixed/hard), drop commit, create branch/tag from commit, and show file history.

**3-way Merge Editor**
> A webview-based 3-way merge editor (base / ours / theirs) using `node-diff3` with inline word-diff highlighting (Shiki). Accept left/right per conflict block, skip, undo, and apply with staging. Conflicts panel lists all conflicted files with Accept Yours/Theirs/Merge actions.

**Push & Rollback**
> Dedicated push dialog (with force-push and rebase/merge-on-reject options) and rollback dialog (selective file revert, delete untracked copies).

**Diff Navigation**
> Open diffs against any ref, navigate next/previous file diff across a commit range, and show working-tree file diff (HEAD ↔ Staged/Working).

**Localization**
> Full Chinese (zh-cn) localization via VSCode's l10n system — both the extension host and the React webview.

## Configuration

| Setting | Type | Default | Description |
| --- | --- | --- | --- |
| `projectAtlas.recentProjectsLimit` | `number` | `50` | Maximum number of recent projects to keep |
| `projectAtlas.openProjectMode` | `ask` / `currentWindow` / `newWindow` | `ask` | Default window behavior when opening a project |
| `projectAtlas.openMode` | `singleClick` / `doubleClick` / `followIDE` | `followIDE` | How a click on a project item opens it |
| `projectAtlas.confirmDelete` | `ask` / `never` | `ask` | Whether to confirm before deleting projects/groups |
| `projectAtlas.showRevealActiveFile` | `boolean` | `true` | Show 'Reveal Active File' button in the built-in file explorer view title |
| `taskAtlas.showRecentRuns` | `boolean` | `true` | Show the recent runs section in the Tasks view |
| `taskAtlas.maxRecentRuns` | `number` | `5` | Maximum number of recent runs to keep (1–20) |
| `taskAtlas.showPinned` | `boolean` | `true` | Show the pinned tasks section in the Tasks view |
| `gitAtlas.commitListStyle` | `vscode` / `jetbrains` | `vscode` | Commit list display style |
| `gitAtlas.commitBadgeMode` | `total` / `current` / `off` | `current` | Change count badge on the Git Commit activity bar icon |
| `gitAtlas.enableGitLogPanel` | `boolean` | `true` | Show the Git Atlas panel (Git Log) in the bottom panel |
| `gitAtlas.enableCommitPanel` | `boolean` | `true` | Show the Commit panel in the activity bar |
| `gitAtlas.aiCommit.apiUrl` | `string` | `""` | AI API base URL or full endpoint (OpenAI-compatible) |
| `gitAtlas.aiCommit.model` | `string` | `""` | AI model name (e.g. gpt-4o-mini, deepseek-chat) |
| `gitAtlas.aiCommit.language` | `auto` / `en` / `zh` / `follow-locale` | `auto` | Language for generated commit messages |
| `gitAtlas.aiCommit.maxDiffChars` | `number` | `8000` | Max diff characters sent to the AI (500–50000) |
| `gitAtlas.aiCommit.customInstructions` | `string` | `""` | Custom instructions appended to the AI prompt |
| `gitAtlas.aiCommit.timeout` | `number` | `30` | Timeout in seconds for AI commit generation (5–300) |

## Keyboard Shortcuts

| Shortcut | Action |
| --- | --- |
| `Alt+O` | Open project picker |
| `Ctrl+Alt+O` | Focus Project Atlas sidebar |
| `Ctrl+Alt+T` | Focus Task Atlas sidebar |
| `Ctrl+Shift+K` | Push (Git Atlas) |
| `Ctrl+F7` | Next file diff (Git Atlas) |
| `Ctrl+Shift+F7` | Previous file diff (Git Atlas) |

## Changelog

See [CHANGELOG.md](https://github.com/sage-z-cn/project-atlas/blob/master/CHANGELOG.md) for release history.

## Credits

The Git Atlas feature builds on code from these open-source projects:
- [jet-git](https://github.com/zhyc9de/jet-git)
- [jetbrains-git-graph](https://github.com/aotemj/jetbrains-git-graph)

With additional multi-repo support (sub-directory git repo detection, repo switching, and status badges).

## License

This project is licensed under the [GNU General Public License v3.0](https://github.com/sage-z-cn/project-atlas/blob/master/LICENSE) — free to use, modify, and distribute. Derivative works must also be licensed under GPL 3.0.
