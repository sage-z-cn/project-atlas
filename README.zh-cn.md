<div align="center"><img src="https://raw.githubusercontent.com/sage-z-cn/project-atlas/master/resources/icon.png" width="128" height="128" alt="Project Atlas"></div>

<h1 align="center">Project Atlas</h1>

<p align="center">自动记录，快速即达。</p>

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

**任务运行器**
> 独立侧边栏管理 `.vscode/tasks.json` 和 `package.json` 中定义的任务。支持一键运行/停止、拖拽排序、实时状态显示。

## 使用说明

安装扩展后，侧边栏会出现两个区域：

**Project Atlas** — 项目管理侧边栏，包含两个面板：

**最近** — 显示所有曾经打开过的项目，按最近访问时间排列。工具栏提供添加项目、克隆仓库、清理无效项目等操作。

**收藏** — 显示已收藏的项目和分组。工具栏提供收藏当前工作区、创建分组、展开/折叠所有分组等操作。支持拖拽排序。

**Task Atlas** — 任务运行器侧边栏，包含一个面板：

**任务** — 列出 `.vscode/tasks.json` 中的任务和 `package.json` 中的 npm 脚本（自动去重）。点击运行，再次点击停止。支持拖拽排序。任务按类型分组，配置文件变更时自动刷新。

在项目面板中点击项目即可打开。右键点击项目可查看更多操作，如重命名、收藏、拷贝路径、在新窗口打开等。

## 配置

| 设置项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `projectExplorer.recentProjectsLimit` | 数字 | `50` | 最近项目视图显示的最大项目数 |
| `projectExplorer.openProjectMode` | 枚举 | `ask` | 打开项目时使用新窗口还是当前窗口。可选值：`ask`（每次询问）、`currentWindow`（当前窗口）、`newWindow`（新窗口） |
| `projectExplorer.openMode` | 枚举 | `followIDE` | 点击项目时的行为。可选值：`singleClick`（单击打开）、`doubleClick`（双击打开）、`followIDE`（跟随 IDE 设置） |
| `projectAtlas.showRevealActiveFile` | 布尔 | `true` | 在内置资源管理器视图标题栏显示"定位当前文件"按钮 |

## 快捷键

| 快捷键 | 功能 |
| --- | --- |
| `Alt+O` | 打开项目选择器 |
| `Ctrl+Alt+O` | 聚焦 Project Atlas 侧边栏 |

## 更新日志

版本历史请参见 [CHANGELOG.md](https://github.com/sage-z-cn/project-atlas/blob/master/CHANGELOG.md)。

## 许可证

本项目基于 [GNU 通用公共许可证 v3.0](https://github.com/sage-z-cn/project-atlas/blob/master/LICENSE) 开源，可自由使用、修改和分发。衍生作品必须同样以 GPL 3.0 许可证发布。

