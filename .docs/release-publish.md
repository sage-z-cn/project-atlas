# 发布功能重构与远程 Release 发布

> 功能设计文档 · Git Atlas 子系统

## 概述

对 commit 面板现有的"发布"（release）tab 进行重构，并将其功能定位拆分为两个独立 tab：

1. **新版本（New Version）** — 现有"发布"功能改名而来：本地创建版本（changelog 更新 + package.json 版本号 + 提交 + 打 tag + 推送）。
2. **发布（Release）** — 新增独立 tab：复刻 GitHub 发布页，将已创建的版本发布为远程平台的正式 Release，支持上传多个附件，支持 GitHub（gh CLI）与 Gitee（API）双平台，一次发布全部推送到所有检测到的远程平台。

两个 tab 存在**联动**：

- 新版本创建成功后，结果弹窗提供"去发布"入口，跳转到发布 tab 并自动填充版本号、标题、Notes。
- 手动进入发布页时，可选择已有 tag，选中后自动从 CHANGELOG 文件读取对应版本的条目填充 Notes。

## 背景与动机

- 现有"发布"tab 承载的是"本地版本管理"（changelog + tag），与"发布到远程平台"（GitHub/Gitee Release 页 + 附件）语义不同，混在一起职责不清。
- 用户明确要求：**不能仅改显示文案，必须连同代码层面全部调整为 newVersion 命名**，否则后续维护混乱。
- 之前曾决定"暂不支持 GitHub Release"，现改为正式支持远程 Release 发布。

## 功能需求

### 需求一：现有 release 功能全量改名 → newVersion

代码层面（非仅文案）全部改名，涉及层：

| 层 | 现名 | 改后 |
|-------|------|------|
| Tab 类型 | `TabType = "commit" \| "stash" \| "release"` | `"commit" \| "stash" \| "newVersion" \| "release"` |
| Tab 切换/渲染 | `activeTab === "release"` | `activeTab === "newVersion"`（原功能） |
| 组件文件 | `ReleaseTab.tsx`、`ReleaseResultPanel.tsx` | `NewVersionTab.tsx`、`NewVersionResultPanel.tsx` |
| Store | `release-store.ts`、`ReleaseContext`、`ReleaseResult`、`ReleaseCommit` | `new-version-store.ts`、`NewVersionContext`、`NewVersionResult`、`NewVersionCommit` |
| Handler | `releaseHandlers.ts`、`registerReleaseHandlers` | `newVersionHandlers.ts`、`registerNewVersionHandlers` |
| AI 服务 | `releaseNotesService.ts` | `newVersionNotesService.ts` |
| 协议命令 | `getReleaseContext` / `generateReleaseChangelog` / `cancelReleaseChangelogGeneration` / `createRelease` / `pushRelease` / `initChangelog` / `updateReleasePrompt` | `getNewVersionContext` / `generateNewVersionChangelog` / `cancelNewVersionChangelogGeneration` / `createNewVersion` / `pushNewVersion` / `initNewVersionChangelog` / `updateNewVersionPrompt` |
| 协议命令（随迁） | `locateCommit`（现注册于 releaseHandlers.ts，与 release 组同区块） | 命令名不变，随文件迁移到 newVersionHandlers.ts |
| CSS 类 | `.release-*`（newVersion 专用部分） | `.new-version-*` |
| 配置键 | `projectAtlas.ai.releasePrompt` | `projectAtlas.ai.newVersionPrompt` + 一次性迁移 |

**配置键迁移**：`projectAtlas.ai.releasePrompt` → `projectAtlas.ai.newVersionPrompt`，沿用 `aiConfigMigration.ts` 模式（`gitAtlas.aiCommit.* → projectAtlas.ai.*` 同款逻辑），激活时检测旧键值迁移到新键，幂等，不破坏已有用户配置。

**`git-atlas.newVersion` 命令**：已存在且命名即匹配 `newVersion` tab。其内部 `switchTab` 事件参数 `{ tab: "release" }` 需改为 `{ tab: "newVersion" }`（见 `gitCommands.ts`，共**两处**广播：初次发送 + 300ms 后针对首次打开 webview 竞态的重播，均需修改）。

### 需求二：新增独立"发布"tab（Release）

复刻 GitHub 发布页（`github.com/{owner}/{repo}/releases/new`）的布局与交互。

#### 发布页字段

| 字段 | 说明 |
|------|------|
| 目标分支（Target） | 下拉选择仓库分支，默认当前分支 |
| 版本 / Tag | 已有 tag 下拉选择 + 支持输入新 tag（新 tag 语义见下文"新 tag 处理"）；**选中已有 tag 后自动从 CHANGELOG 读取对应版本条目填充 Notes** |
| 标题（Title） | 默认 `v{version}` 或自定义 |
| Notes | 发布说明，支持 Markdown；可复用新版本 tab 的 changelog 草稿 |
| 附件（Assets） | 多文件上传（`showOpenDialog canSelectMany`），不限制扩展名，已选列表可移除单项/全部清空，显示文件名+大小，**Gitee 单附件 ≤100M** 校验（社区实测值，官方 API 未标注，校验阈值建议预留缓冲） |
| 预发布（Prerelease） | 复选框，`gh release create --prerelease` / Gitee `prerelease` 字段 |
| 草稿（Draft） | 复选框，`gh release create --draft`（Gitee API 无草稿概念，仅 GitHub 生效） |
| 发布按钮 | "发布" / "发布到所有平台" |

#### 多平台发布

- 自动扫描 `git remote -v` 全部 remote，解析 URL host 识别平台：
  - `github.com` → GitHub
  - `gitee.com` → Gitee
  - 其他 → 忽略（提示不支持）
- **一次发布全部推送到所有识别出的平台**，每个平台独立记录成功/失败。
- 平台预检（`getRemoteReleaseTargets`）：
  - GitHub：`gh --version` 是否安装 + `gh auth status` 是否已登录（退出码 0 = 已认证、1 = 未登录/异常，输出在 stderr；**勿加 `--json`**，会掩盖认证失败）
  - Gitee：SecretStorage 是否已存 token
- 发布前确保 tag 已到达目标平台：对每个平台执行 `git push <remoteName> <tag>`（remote 名不一定是 origin，按该平台对应的 remote 名推送）。

#### 新 tag 处理

发布页支持输入新 tag，此时本地尚不存在该 tag，无法直接推送。约定：

- 输入新 tag → 扩展侧先 `git tag <tagName> <targetBranch>`（在目标分支最新 commit 上创建），再逐平台 `git push <remoteName> <tag>`；
- 不依赖 gh 的 `--target` 自动建 tag，也不依赖 Gitee 创建 Release 时的自动建 tag 行为（官方未文档化），保证两平台路径一致；
- 已有 tag 但某平台远程缺失时，同样补推送到该 remote。

#### 附件交互

- **选择**：附件区"选择附件"按钮 → `vscode.window.showOpenDialog({ canSelectMany: true })` 打开系统文件选择器多选。**不限制扩展名**。
- **追加**：可多次点击追加，重复选择自动去重（按完整路径）。
- **列表展示**：每项显示文件名 + 文件大小（B/KB/MB 格式化），单项可移除，另有"全部清空"按钮。
- **大小校验**：**Gitee 单个附件不超过 100M**（官方 API 文档未标注，为社区实测共识，校验阈值建议预留缓冲，如 95M）——选中时对超出项标记（如红色警告），发布时拒绝超限文件上传到 Gitee 平台；GitHub 单文件上限 2 GiB、单 release 最多 1000 个附件。
- **不支持拖拽**：webview 受 CSP/沙箱限制拿不到拖入文件的磁盘路径，仅用 `showOpenDialog`。
- **上传对映**：GitHub 由 `gh release create <tag> <files...>` 一次传入；Gitee 逐个 `POST .../attach_files`（multipart `file`）。某附件上传失败 → 该平台整体标记失败，错误信息含失败文件名。

### 平台能力（已调研确认）

| 平台 | 创建 Release | 上传附件 | 认证 |
|------|-------------|---------|------|
| GitHub | `gh release create <tag> -R <owner>/<repo> --title <t> --notes-file <f> --target <branch> --prerelease --draft <files...>`（多附件原生支持，还支持 glob 与 `文件#显示名`） | 同上一步（命令后追加附件路径） | `gh` CLI，需已 `gh auth login` |
| Gitee | `POST /api/v5/repos/{owner}/{repo}/releases`，body：`access_token` / `tag_name` / `name` / `body` / `prerelease` / `target_commitish` | `POST /api/v5/repos/{owner}/{repo}/releases/{release_id}/attach_files`，multipart 字段名 `file` | Personal Access Token |

**已核实细节（官方文档/源码）**：

- gh **必须显式 `-R <owner>/<repo>`**：非交互模式下 gh 按 `upstream > github > origin > 其他（字母序）` 优先级自动选 remote，且只统计指向 GitHub host 的 remote。仓库存在 `upstream`/`github` 命名的 remote 或多个 GitHub remote 时，不写 `-R` 会静默发布到错误仓库。服务已从 remote URL 解析出 owner/repo，固定传 `-R`。
- `--target` 仅在远程 tag 不存在时用于自动建 tag；本方案不依赖它（见"新 tag 处理"）。
- 长 Notes 用 `--notes-file`（写临时文件）而非 `--notes` 命令行参数，规避 Windows 参数长度限制。
- Gitee `target_commitish` 在 OpenAPI 规范中为**必填**（分支名或 commit SHA），无论 tag 是否已存在都传入 targetBranch。
- Gitee 无 Draft（草稿）概念（Release 模型无 draft 字段），草稿选项仅对 GitHub 生效。
- GitHub 附件上限：单文件 2 GiB、单 release 最多 1000 个。

### 需求三：新版本 → 发布联动跳转

新版本创建成功后的结果弹窗（`NewVersionResultPanel`）中新增"去发布"按钮，点击后：

1. 切换到发布 tab（`setActiveTab("release")`）
2. 自动预填发布表单：
   - 版本/Tag → 新版本刚创建的 `tagName`
   - 标题（Title）→ 默认 `v{version}`
   - Notes → 新版本创建时写入 changelog 的条目内容（即 `changelogDraft`）
   - 目标分支 → 当前分支
   - 附件 → 不预填，用户自选
3. 用户确认补充附件等后直接发布

**跨 tab 数据传递**：`release-store`（新发布 store）暴露 `prefill: PrefillRelease | null` 字段；`NewVersionResultPanel` 点击"去发布"时写入预填数据并切 tab，`ReleaseTab` 挂载/激活时消费 `prefill` 并清空。预填数据含 `{ tagName, version, title, notes, targetBranch }`。

### 需求四：手动进入发布页时选择 tag 自动填充 CHANGELOG

手动进入发布页（无联动跳转）时：

1. 发布页提供 tag 下拉选择（读取 `git tag` 已有 tag）
2. 选中某 tag 后，自动从 CHANGELOG 文件读取该版本对应的条目内容，填充 Notes 编辑器
3. 解析规则：在 CHANGELOG 中查找版本标题行（匹配 `#### {version}`、`## [{version}]`、`# v{version}` 等标题格式，去 `v/V` 前缀后比对版本号），提取该标题之后到下一个标题之前的全部内容作为条目。其中 `#### {version}` 是本扩展 createRelease 写入 CHANGELOG 的原生格式（无 `v` 前缀、无方括号）
4. 无 CHANGELOG 文件或未匹配到该版本 → Notes 留空，不报错
5. tag 重新选择时，Notes 被新选中版本的内容覆盖（除非用户已手动编辑过）

**后端命令**：新增 `getChangelogEntryForTag` handler，参数 `{ tagName }`，返回 `{ notes: string }`（空串表示无匹配）。

### 配置项

新增 `projectAtlas.git.giteeToken`（SecretStorage，沿用 `projectAtlas.ai.apiKey` 模式）：

| SecretStorage 键 | 类型 | 存储 | 说明 |
|-------|------|------|------|
| `projectAtlas.git.giteeToken` | string | SecretStorage（**非 package.json configuration 属性**） | Gitee Personal Access Token；注册 `git-atlas.setGiteeToken` / `git-atlas.clearGiteeToken` 命令作为设置入口，触发输入框存储 |

GitHub 认证走 gh CLI 自身登录态（`gh auth login`），不额外存 token。

---

## 技术设计

### 架构总览

```
┌─────────────────────────┐   bridge.request    ┌──────────────────────────────┐
│ Webview (React)         │ ──────────────────► │ Extension Host                │
│                         │  getRemoteRelease   │                              │
│ NewVersionTab (新版本)  │   Targets           │ newVersionHandlers.ts         │
│ ReleaseTab   (发布)     │ ◄────────────────── │   ├─ newVersionNotesService   │
│                         │  createRelease      │   └─ releaseHandlers.ts        │
└─────────────────────────┘                     │        └─ remoteReleaseService │
                                                │             ├─ gh CLI (spawn)  │
                                                │             └─ Gitee API(fetch)│
                                                └──────────────────────────────┘
```

### 数据流

**发布页常规流程：**

1. 发布 tab 挂载 → 发送 `getRemoteReleaseTargets` → 返回平台列表（platform/remoteName/owner/repo/configured/authOk）+ 分支列表 + tag 列表
2. 用户选择平台目标、填标题/Notes、选附件 → 点"发布"
3. Webview 发送 `createRelease`（新命令，参数：`{ targets, tagName, title, notes, targetBranch, prerelease, draft, attachments[] }`）
4. 扩展侧逐平台执行：GitHub 走 gh CLI 子进程（显式 `-R owner/repo`），Gitee 走 HTTP API；每个平台先 `git push <remoteName> <tag>` 确保 tag 已到达该平台远程，再创建 Release，再逐个上传附件
5. 返回每平台结果 `{ platform, remoteName, success, url?, error? }[]`
6. Webview 展示结果弹窗（成功平台含 Release 链接，失败平台含错误信息）

**联动跳转（需求三）：**

1. `NewVersionResultPanel` 点击"去发布" → 写入 `release-store.prefill`（tagName/version/title/notes/targetBranch）→ `setActiveTab("release")`
2. `ReleaseTab` 挂载/激活时读 `prefill` 填充表单并清空该字段

**手动 tag 填充（需求四）：**

1. 发布页选择 tag → 发送 `getChangelogEntryForTag { tagName }`
2. Handler 读 CHANGELOG 文件，按版本标题解析条目 → 返回 `{ notes }`
3. Webview 填充 Notes 编辑器（用户已手动编辑时跳过覆盖）

### 新增文件

| 文件 | 说明 |
|------|------|
| `src/git/remoteReleaseService.ts` | gh CLI 子进程封装（execFileAsync）+ Gitee API 调用（fetch）+ remote URL 解析（platform/owner/repo）+ SecretStorage token 读写 |
| `src/commands/gitHandlers/releaseHandlers.ts`（新建，非改名） | `getRemoteReleaseTargets` / `createRelease` / `getChangelogEntryForTag` 三个 handler |
| `webview/src/shared/store/release-store.ts`（新建，非改名） | 发布 tab store |
| `webview/src/commit/components/ReleaseTab.tsx`（新建，非改名） | 发布 tab 组件（复刻 GitHub 发布页） |
| `webview/src/commit/components/Modal.tsx` | 通用 ModalOverlay（从 PromptEditor.tsx 抽出，newVersion 与 release 共用） |

### 改名清单（现有 release → newVersion）

#### 扩展端

| 文件/符号 | 变更 |
|------|------|
| `src/commands/gitHandlers/releaseHandlers.ts` | 改名 `newVersionHandlers.ts`，`registerReleaseHandlers` → `registerNewVersionHandlers`，内部命令名全改 |
| `src/ai/releaseNotesService.ts` | 改名 `newVersionNotesService.ts` |
| `src/ai/aiClient.ts` | `AiSettings.releasePrompt` → `newVersionPrompt`，读取键改 `newVersionPrompt` |
| `src/ai/aiConfigMigration.ts` | 新增 `releasePrompt → newVersionPrompt` 迁移（独立标记键） |
| `src/git/setupGit.ts` | `registerReleaseHandlers(ctx)` → `registerNewVersionHandlers(ctx)` |
| `src/commands/gitCommands.ts` | `git-atlas.newVersion` 命令内 `switchTab` 参数 `{ tab: "release" }` → `{ tab: "newVersion" }`（两处广播：初次 + 300ms 重播） |
| `src/messages/protocol.ts` | `CommandType` release 命令改 newVersion 命名（`locateCommit` 名称不变，仅随文件迁移） |
| `src/git/types.ts` | `ReleaseCommitSummary` 接口 → `NewVersionCommitSummary`（`getLogRange` 返回类型） |
| `src/git/gitService.ts` | `getLogRange` 签名/注释中的 `ReleaseCommitSummary` 同步改（注意：分支前缀数组中的 `"release"` 字符串是分支名，**不要改**） |
| `README.md` / `README.zh-cn.md` | `projectAtlas.ai.releasePrompt` 文案改为 `newVersionPrompt` |
| `webview/src/shared/bridge/types.ts` | `CommandType` 同步改 + 新增发布命令 |

#### Webview 端

| 文件/符号 | 变更 |
|------|------|
| `webview/src/shared/store/commit-store.ts` | `TabType` 加 `"newVersion"` 与 `"release"`；`setActiveTab` / `switchTab` 事件处理同步 |
| `webview/src/commit/App.tsx` | tab 按钮：原 Release → New Version（`newVersion`），新增 Release（`release`） |
| `webview/src/shared/store/release-store.ts` | 改名 `new-version-store.ts`，`useReleaseStore` → `useNewVersionStore`，类型/命令名全改 |
| `webview/src/commit/components/ReleaseTab.tsx` | 改名 `NewVersionTab.tsx` |
| `webview/src/commit/components/ReleaseResultPanel.tsx` | 改名 `NewVersionResultPanel.tsx` |
| `webview/src/commit/components/PromptEditor.tsx` | 拆分：`ModalOverlay` 抽到 `Modal.tsx`（通用），其余保留为 newVersion 提示词编辑器 |
| `webview/src/commit/components/ChangelogSection.tsx` | 导入 `useReleaseStore`/`ReleaseContext` 及 `.release-changelog-*` / `.release-ai-banner*` / `.release-lang-*` 等类名全改 newVersion（24 处） |
| `webview/src/commit/components/ChangelogInitForm.tsx` | 导入 store 及 `.release-init-*` 等类名改 newVersion（17 处） |
| `webview/src/commit/components/CommitRangeList.tsx` | 导入 `useReleaseStore`/`ReleaseCommit` 及 `.release-commit-*` 等类名改 newVersion（14 处） |
| `webview/src/commit/commit.css` | `.release-*` 拆分：newVersion 专用 → `.new-version-*`；ModalOverlay 样式 → 通用 `.modal-*` |

> **注意**：
>
> - 原 `release-store.ts` 中 `activeTab === "release"` 的 5 处判断（fetchContext 竞态、markDirty、3 处事件过滤）全部改为 `"newVersion"`。
> - `App.tsx` 另有 2 处 `activeTab === "release"`（tab 按钮 active 态 + 条件渲染）；`commit-store.ts` 有 `TabType` 定义（当前**未导出**，新 store/组件如需引用要先加 export）和 switchTab 事件白名单，共 4 处同步改。
> - grep 验收时的已知误报白名单：`gitService.ts` 分支前缀数组中的 `"release"`、`useDraggableDivider.ts` 的 `releasePointerCapture`、`RepoSelector.css` 注释。

### 命名冲突说明

本次重构使"release"命名被新发布功能占用，因此**必须**先完成现有 release → newVersion 的全量改名，再以干净的 `release` 命名创建新文件（`releaseHandlers.ts`、`release-store.ts`、`ReleaseTab.tsx`）。顺序不可颠倒。

---

## 实施顺序

```
Phase 0: 全量改名（现有 release → newVersion）
  ├─ 扩展端：文件重命名 + 符号/命令改名 + setupGit 接线
  ├─ 配置迁移：releasePrompt → newVersionPrompt（aiClient 读取 + migration）
  └─ Webview 端：store/组件/App/CSS 改名 + TabType 扩展

Phase 1: 远程发布后端（依赖 Phase 0 腾出 release 命名）
  ├─ remoteReleaseService.ts（gh CLI + Gitee API + remote 解析 + token）
  ├─ releaseHandlers.ts（getRemoteReleaseTargets / createRelease / getChangelogEntryForTag）
  └─ 协议注册 + 配置项 + 设置命令

Phase 2: 发布 tab 前端（依赖 Phase 1）
  ├─ release-store.ts + ReleaseTab.tsx（复刻 GitHub 发布页）
  ├─ App.tsx 接入第 4 个 tab
  ├─ Modal.tsx 通用弹窗抽取
  └─ 联动跳转（需求三）+ 手动 tag 填充（需求四）

Phase 3: 国际化 + 验证
  ├─ l10n：现有 23 处 release/发布键中服务于旧 tab 的（"Create Release"/"Confirm Release"/"Release created" 等）随 newVersion 改写措辞，避免与新发布 tab 文案混淆；新增发布 tab 全套文案
  └─ package.nls + lint/compile
```

## 验证清单

### 改名验证（Phase 0）

- [ ] `src/` 与 `webview/src/` 中无残留 `release` 符号（白名单除外：新发布功能本身、`gitService.ts` 分支前缀数组中的 `"release"`、`useDraggableDivider.ts` 的 `releasePointerCapture`、`RepoSelector.css` 注释）
- [ ] `projectAtlas.ai.releasePrompt` 旧配置值迁移到 `projectAtlas.ai.newVersionPrompt`
- [ ] 新版本 tab 完整可用：context 加载、changelog 生成、创建、推送、结果弹窗
- [ ] `git-atlas.newVersion` 命令切换到新版本 tab（两处 switchTab 广播均已更改）
- [ ] `locateCommit` 命令随 newVersionHandlers.ts 迁移后仍正常可用
- [ ] 原 Release 相关的 `EventType`/`CommandType` 全部改名为 newVersion

### 发布 tab 验证（Phase 1-2）

- [ ] 仅 GitHub remote → 只显示 GitHub 目标
- [ ] 仅 Gitee remote → 只显示 Gitee 目标
- [ ] 同时有 GitHub + Gitee remote → 两个目标都显示，一次发布全部推送
- [ ] GitHub 未安装 gh / 未登录 → 平台显示未配置，提示引导
- [ ] Gitee 未存 token → 平台显示未配置，点击弹 token 输入
- [ ] 选择多个附件 → 发布后远程平台 Release 附件齐全
- [ ] 附件列表可移除单项
- [ ] "全部清空"一键移除所有已选附件
- [ ] 重复选择同一文件去重
- [ ] 超出 100M 的附件在选中时被标记，Gitee 平台拒绝上传超限文件
- [ ] 任意扩展名文件均可选择
- [ ] 预发布/草稿选项正确传递
- [ ] 单平台失败不影响其他平台（各自记录错误）
- [ ] 发布成功后显示 Release 链接（平台页面 URL）

### 联动与手动填充验证（需求三/四）

- [ ] 新版本创建成功后结果弹窗出现"去发布"按钮
- [ ] 点击"去发布"切换到发布 tab，Tag/标题/Notes/目标分支正确预填
- [ ] 预填的 Notes 与新版本 changelog 草稿一致
- [ ] 手动进入发布页：选择 tag 后 Notes 自动填充对应 CHANGELOG 条目
- [ ] 手动编辑 Notes 后再换 tag → Notes 不被覆盖
- [ ] CHANGELOG 无该版本或无文件 → Notes 留空且不报错
- [ ] `#### {version}`、`## [{version}]`、`# v{version}` 三种标题格式均能解析

## 文件变更清单

### 新建文件

| 文件 | 说明 |
|------|------|
| `src/git/remoteReleaseService.ts` | 双平台发布服务 |
| `src/commands/gitHandlers/releaseHandlers.ts` | 发布 tab handler（改名完成后新建） |
| `webview/src/shared/store/release-store.ts` | 发布 tab store（改名完成后新建） |
| `webview/src/commit/components/ReleaseTab.tsx` | 发布 tab 组件（改名完成后新建） |
| `webview/src/commit/components/Modal.tsx` | 通用 ModalOverlay |

### 改名文件

| 现名 | 新名 |
|------|------|
| `src/commands/gitHandlers/releaseHandlers.ts` | `src/commands/gitHandlers/newVersionHandlers.ts` |
| `src/ai/releaseNotesService.ts` | `src/ai/newVersionNotesService.ts` |
| `webview/src/shared/store/release-store.ts` | `webview/src/shared/store/new-version-store.ts` |
| `webview/src/commit/components/ReleaseTab.tsx` | `webview/src/commit/components/NewVersionTab.tsx` |
| `webview/src/commit/components/ReleaseResultPanel.tsx` | `webview/src/commit/components/NewVersionResultPanel.tsx` |

### 修改文件

| 文件 | 变更 |
|------|------|
| `package.json` | 配置键改 `newVersionPrompt` + 新增 Gitee token 设置/清除命令（giteeToken 本身不走 configuration）+ 发布相关命令 |
| `package.nls.json` / `package.nls.zh-cn.json` | config + command 文案 |
| `l10n/bundle.l10n.zh-cn.json` | 发布页全套运行时文案 |
| `src/ai/aiClient.ts` / `src/ai/aiConfigMigration.ts` | newVersionPrompt 读取 + 迁移 |
| `src/git/setupGit.ts` | handler 接线改名 |
| `src/commands/gitCommands.ts` | switchTab 目标改 newVersion |
| `src/messages/protocol.ts` | CommandType 改名 + 新增 |
| `webview/src/shared/bridge/types.ts` | CommandType 同步 |
| `webview/src/shared/store/commit-store.ts` | TabType + switchTab |
| `webview/src/commit/App.tsx` | 第 4 个 tab + 改名 |
| `webview/src/commit/commit.css` | 样式类改名/拆分 |
| `src/git/types.ts` / `src/git/gitService.ts` | `ReleaseCommitSummary` → `NewVersionCommitSummary` 及签名/注释同步 |
| `README.md` / `README.zh-cn.md` | `releasePrompt` 配置键文案更新 |
| `webview/src/commit/components/ChangelogSection.tsx` / `ChangelogInitForm.tsx` / `CommitRangeList.tsx` | store 导入与 `.release-*` 类名改 newVersion |
