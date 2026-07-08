<div align="center"><img src="https://raw.githubusercontent.com/sage-z-cn/project-atlas/master/resources/icon.png" width="128" height="128" alt="Project Atlas"></div>

<h1 align="center">Project Atlas</h1>

<p align="center">自动记录项目、快速访问、任务运行器、JetBrains 风格 Git 集成。</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-GPL--3.0-blue.svg" alt="GPL 3.0 License">
  <img src="https://img.shields.io/badge/VS%20Code-%5E1.120.0-green.svg" alt="VS Code ^1.120.0">
</p>

<p align="center">
  <a href="https://github.com/sage-z-cn/project-atlas/blob/master/README.md">English</a> | <a href="https://github.com/sage-z-cn/project-atlas/blob/master/README.zh-cn.md">中文文档</a>
</p>

---

<p align="center">
  <img src="https://raw.githubusercontent.com/sage-z-cn/project-atlas/master/screenshot/screenshot-zh.png" alt="Project Atlas 侧边栏">
</p>

## 功能特性

### Project Atlas

**自动记录**
> 自动追踪每次打开的项目，无需手动维护。

**快速访问**
> 从侧边栏直接打开项目，支持单击/双击方式和新旧窗口选择，快捷键一键直达。

**收藏与分组**
> 收藏常用项目，按技术栈或用途创建命名分组，支持展开/折叠。支持拖拽排序。

**Git 克隆**
> 直接从侧边栏克隆仓库，无需离开编辑器。

**项目类型识别**
> 自动识别 16+ 种项目类型并显示对应的 devicon 图标。

**项目管理**
> 自定义显示名称、清理失效项目、在资源管理器中显示，右键菜单快速操作。

**定位当前文件**
> 在内置资源管理器标题栏添加定位按钮，一键在文件树中定位当前编辑的文件（可在设置中开关）。

### Task Atlas

**任务运行器**
> 独立侧边栏管理 `.vscode/tasks.json` 和 `package.json` 中定义的任务。支持运行/停止、固定、拖拽排序、实时状态显示。任务按项目分组，配置文件变更时自动刷新。

### Git Atlas

**可视化 Git Log**
> 底部面板的提交历史图，采用自研 SVG 车道布局，含分支树（本地/远程/标签）、可折叠提交序列、详情面板与变更文件树。支持按分支、作者、日期范围或文件筛选。

**IDEA 风格提交面板**
> 活动栏提交面板，变更/已暂存/未版本化文件分组、目录树、修订提交、最近提交消息、提交并推送拆分按钮。内置 git stash（搁置）与 IDEA 兼容 shelf（`.idea/shelf/`），支持 patch 导入/导出。

**多仓库支持**
> 含子目录 git 仓库的工作区，在 Git Log 和提交视图中都会显示仓库选择器。一键切换当前仓库；状态徽标（↑待推送 / ↓待拉取 / ●未提交）实时更新。

**分支操作**
> 检出、创建、重命名、删除（含强制删除与合并检查）、合并、变基（含检出并变基）、与当前分支比较 —— 全部在分支树右键菜单中完成。

**提交操作**
> 拣选（cherry-pick）、还原、重置（soft/mixed/hard）、删除提交、从提交创建分支/标签、显示文件历史。

**三方合并编辑器**
> 基于 webview 的三方合并编辑器（base / ours / theirs），采用 `node-diff3` 算法与行内词级差异高亮（Shiki）。按冲突块接受左侧/右侧、跳过、撤销、应用并暂存。冲突面板列出所有冲突文件，支持接受我方/他方/合并。

**推送与回滚**
> 专用推送对话框（强制推送 + 被拒绝时变基/合并选项）和回滚对话框（选择性文件还原、删除未跟踪副本）。

**差异导航**
> 对任意 ref 打开差异、跨提交范围导航上一/下一文件差异、显示工作区文件差异（HEAD ↔ 暂存/工作区）。

**本地化**
> 通过 VSCode l10n 系统提供完整中文（zh-cn）支持 —— 扩展宿主端与 React webview 均已本地化。

## 使用说明

安装扩展后，侧边栏和底部面板会出现以下区域：

**Project Atlas** — 项目管理侧边栏，包含两个面板：

**最近** — 显示所有曾经打开过的项目，按最近访问时间排列。工具栏提供添加项目、克隆仓库、清理无效项目等操作。

**收藏** — 显示已收藏的项目和分组。工具栏提供收藏当前工作区、创建分组、展开/折叠所有分组等操作。支持拖拽排序。

**Task Atlas** — 任务运行器侧边栏：

**任务** — 列出 `.vscode/tasks.json` 中的任务和 `package.json` 中的 npm 脚本（自动去重）。点击运行，再次点击停止。支持拖拽排序。任务按项目分组，配置文件变更时自动刷新。

**Git Atlas** — 跨两个位置的 Git 集成：

**Git Log**（底部面板）— 可视化提交历史图，含分支树、车道布局、提交详情、差异导航。通过仓库选择器切换子目录仓库；状态徽标显示待推送/待拉取/未提交计数。

**Commit**（活动栏）— 暂存、提交、推送/拉取、搁置（git stash）与 IDEA 兼容 shelf。工作区变更按目录分组。仓库选择器含状态徽标。

在项目面板中点击项目即可打开。右键点击项目可查看更多操作，如重命名、收藏、拷贝路径、在新窗口打开等。

## 配置

| 设置项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `projectAtlas.recentProjectsLimit` | 数字 | `50` | 最近项目视图显示的最大项目数 |
| `projectAtlas.openProjectMode` | 枚举 | `ask` | 打开项目时使用新窗口还是当前窗口。可选值：`ask`（每次询问）、`currentWindow`（当前窗口）、`newWindow`（新窗口） |
| `projectAtlas.openMode` | 枚举 | `followIDE` | 点击项目时的行为。可选值：`singleClick`（单击打开）、`doubleClick`（双击打开）、`followIDE`（跟随 IDE 设置） |
| `projectAtlas.confirmDelete` | 枚举 | `ask` | 删除项目/分组前是否确认。可选值：`ask`（每次询问）、`never`（不确认） |
| `projectAtlas.showRevealActiveFile` | 布尔 | `true` | 在内置资源管理器视图标题栏显示"定位当前文件"按钮 |
| `taskAtlas.showRecentRuns` | 布尔 | `true` | 在任务视图中显示最近运行区域 |
| `taskAtlas.maxRecentRuns` | 数字 | `5` | 最近运行保留的最大数量（1–20） |
| `taskAtlas.showPinned` | 布尔 | `true` | 在任务视图中显示固定任务区域 |

## 快捷键

| 快捷键 | 功能 |
| --- | --- |
| `Alt+O` | 打开项目选择器 |
| `Ctrl+Alt+O` | 聚焦 Project Atlas 侧边栏 |
| `Ctrl+Alt+T` | 聚焦 Task Atlas 侧边栏 |
| `Ctrl+Shift+K` | 推送（Git Atlas） |
| `Ctrl+F7` | 下一文件差异（Git Atlas） |
| `Ctrl+Shift+F7` | 上一文件差异（Git Atlas） |

## 更新日志

版本历史请参见 [CHANGELOG.md](https://github.com/sage-z-cn/project-atlas/blob/master/CHANGELOG.md)。

## 致谢

Git Atlas 功能引用了以下开源仓库的代码：
- [jet-git](https://github.com/zhyc9de/jet-git)
- [jetbrains-git-graph](https://github.com/aotemj/jetbrains-git-graph)

并在此基础上增加了多仓库支持（子目录 git 仓库检测、仓库切换、状态徽标）。

## 许可证

本项目基于 [GNU 通用公共许可证 v3.0](https://github.com/sage-z-cn/project-atlas/blob/master/LICENSE) 开源，可自由使用、修改和分发。衍生作品必须同样以 GPL 3.0 许可证发布。
