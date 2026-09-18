# Git Atlas 新功能 TODO

> 来源：用户选定的四项待做功能（2026-02）。实现按顺序推进，完成后在本文件勾选。

## 1. Upstream 设置（优先）

**状态**: 已完成

**目标**: 在分支树上下文菜单中管理本地分支的上游跟踪。

- [x] `GitService.setUpstream(branch, remoteBranch)` / `unsetUpstream(branch)`
- [x] 协议命令：`setBranchUpstream` / `unsetBranchUpstream`
- [x] `branchHandlers.ts` 注册处理
- [x] 本地分支菜单：
  - `Set Upstream...` / `Change Upstream...`（缺省 `remoteBranch` 时扩展侧 QuickPick，优先同名远程分支）
  - `Unset Upstream`（已有 upstream 时显示，带确认）
- [x] 远程分支菜单：
  - `Track as Upstream for Local Branch...`（QuickPick 本地分支）
  - 同名本地分支快捷项 `Track '{local}' to '{remote}'`
- [x] webview `t()` + `l10n/bundle.l10n.zh-cn.json` 中文
- [x] `npm run compile`（extension + webview tsc）通过；`npm run lint` 0 errors（仅存量 curly 警告）

**Git 命令**:
- 设置: `git branch --set-upstream-to=<remoteBranch> <localBranch>`
- 取消: `git branch --unset-upstream <localBranch>`

---

## 2. Cherry-pick 范围

**状态**: 已完成

**目标**: Git Log 中多选提交后，按时间顺序（旧→新）批量 cherry-pick。

- [x] Log 列表多选（Ctrl/Shift 已有）+ 右键「Cherry-Pick N Commits」
- [x] 协议：`cherryPickRange { hashes: string[] }`（服务端 `rev-list --no-walk=sorted --reverse` 旧→新）
- [x] `GitService.cherryPickRange`：逐个 cherry-pick，冲突/失败即停并返回进度
- [x] 返回 `{ appliedHashes, total, failedHash?, conflicted?, error? }`；冲突时 toast + 打开冲突面板
- [x] 多选时保留「Cherry-Pick（仅此提交）」单项操作
- [x] 中文本地化
- [x] `npm run compile` + `npm run lint`

---

## 3. Unversioned → .gitignore

**状态**: 待做

**目标**: 未版本文件（unversioned）右键加入 `.gitignore`。

- [ ] 协议：`addToGitignore { paths: string[], mode?: "file" | "folder" }`
- [ ] 实现：解析相对仓库根的 ignore 模式，追加到根目录 `.gitignore`（无则创建）；已匹配则提示
- [ ] 忽略模式规则：文件用相对路径；对目录建议 `path/` 或按选择
- [ ] `VscodeFileContextMenu` / 批量菜单：`Add to .gitignore`
- [ ] 可选：`Open .gitignore`
- [ ] 中文本地化
- [ ] 构建 + lint

---

## 4. 多仓库：拖拽排序

**状态**: 待做

**目标**: RepoSelector 中拖拽调整仓库显示顺序，顺序持久化。

- [ ] 扩展侧持久化顺序（建议 `workspaceState` key：`gitAtlas.repoOrder`，存 path 数组）
- [ ] `getRepos` 返回时按保存顺序排序，新扫描仓库追加在末尾
- [ ] 协议：`setRepoOrder { order: string[] }`
- [ ] `RepoSelector`（panel + commit 共用 body）支持 HTML5 drag 或指针拖拽
- [ ] 拖拽结束写回顺序，刷新列表
- [ ] 中文本地化（提示文案）
- [ ] 构建 + lint

---

## 约定

- 扩展代码变更后自行运行 `npm run compile` / lint，不向用户询问是否编译安装。
- 运行时文案走 `vscode.l10n.t` + `l10n/bundle.l10n.zh-cn.json`，命令标题走 NLS（若新增 command）。
- 协议命令补进 `src/messages/protocol.ts` 的 `CommandType`。
