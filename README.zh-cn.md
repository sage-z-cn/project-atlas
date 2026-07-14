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

### TODO Atlas

**手动 TODO**
> 底部面板创建全局（跨工作区）或项目级 TODO。勾选标记完成、双击内联编辑、复制、拖拽排序、删除，创建/完成时间显示在 tooltip 中。

**注释扫描**
> 扫描源码中的 `TODO` / `FIXME` / `XXX` / `HACK` / `BUG` / `NOTE` 注释，按标签分组，点击跳转源码。支持 `TODO(name)` 指派人提取。扫描结果缓存到 workspace state，重开时即时显示。

**多仓库分组**
> 多仓库工作区的项目级 TODO 按子仓库分组（复用 Git Atlas 仓库识别），根目录的 TODO 直接显示在项目段下。

**右键菜单与行内操作**
> 每行右键菜单（手动项：标记完成/复制/编辑/删除；扫描项：跳转源码/复制）+ 悬停操作按钮。

**面板开关**
> 默认关闭。通过设置中的 `todoAtlas.enabled` 开启，即时显隐，无需重载。

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
| `gitAtlas.commitListStyle` | 枚举 | `vscode` | 提交列表显示风格。可选值：`vscode`、`jetbrains` |
| `gitAtlas.commitBadgeMode` | 枚举 | `current` | 活动栏提交图标更改数量徽标。可选值：`total`（所有仓库总和）、`current`（仅当前仓库）、`off`（不显示） |
| `gitAtlas.enableGitLogPanel` | 布尔 | `true` | 启用底部面板中的 Git Atlas 面板（Git Log）。即时生效，无需重载 |
| `gitAtlas.enableCommitPanel` | 布尔 | `true` | 启用活动栏中的提交面板。即时生效，无需重载 |
| `gitAtlas.aiCommit.apiUrl` | 字符串 | `""` | AI API 基础地址或完整端点（OpenAI 兼容） |
| `gitAtlas.aiCommit.model` | 字符串 | `""` | AI 模型名称（如 gpt-4o-mini、deepseek-chat） |
| `gitAtlas.aiCommit.language` | 枚举 | `auto` | 生成提交信息的语言。可选值：`auto`（自动检测）、`en`、`zh`、`follow-locale`（跟随显示语言） |
| `gitAtlas.aiCommit.maxDiffChars` | 数字 | `8000` | 发送给 AI 的最大 diff 字符数（500–50000），超出截断 |
| `gitAtlas.aiCommit.customInstructions` | 字符串 | `""` | 追加到 AI 提示词的自定义提交规则 |
| `gitAtlas.aiCommit.timeout` | 数字 | `30` | AI 生成提交信息的超时时间（秒，5–300） |
| `todoAtlas.enabled` | 布尔 | `false` | 在底部面板显示 TODO Atlas 面板（即时生效，无需重载） |
| `todoAtlas.scan.enabled` | 布尔 | `true` | 启用扫描源码文件中的 TODO/FIXME 注释 |
| `todoAtlas.scan.autoScan` | 布尔 | `false` | 窗口聚焦和保存文件时自动扫描（关闭后仅靠重新扫描按钮触发） |
| `todoAtlas.scan.tags` | 数组 | `["TODO","FIXME","XXX","HACK","BUG","NOTE"]` | 扫描的注释标签列表 |
| `todoAtlas.scan.exclude` | 数组 | `["**/node_modules/**","**/.git/**","**/dist/**","**/out/**","**/build/**","**/.vscode-test/**","**/*.min.js","**/*.map"]` | 扫描时排除的 glob 模式 |
| `todoAtlas.scan.debounceMs` | 数字 | `500` | 保存文件时增量重扫的防抖时间（毫秒，100–3000） |
| `todoAtlas.showCompleted` | 布尔 | `true` | 在列表中显示已完成的 TODO |
| `todoAtlas.groupBy` | 枚举 | `scope` | 视图中 TODO 的分组方式。可选值：`scope`（按范围）、`tag`（按标签）、`file`（按文件）、`none`（不分组） |

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
