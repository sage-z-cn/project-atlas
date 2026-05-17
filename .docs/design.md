# Project Explorer 功能设计

自动记录 VS Code 打开的项目，支持分组管理和一键切换。

## 核心功能

### 自动记录项目

每次 VS Code 打开工作区（文件夹或 .code-workspace）时，自动将项目信息记录到列表中。

- **名称**: 默认取根文件夹名称，用户可手动修改
- **路径**: 工作区根路径
- **最后打开时间**: 每次打开时更新
- 已存在的项目仅更新最后打开时间，不重复添加

### 数据存储

使用 VS Code 的 `globalState` API 存储项目数据，**禁用同步**（项目路径与机器绑定，同步无意义）。

数据结构：

```typescript
interface ProjectItem {
  id: string;
  name: string;
  path: string;
  lastOpenedAt: number; // timestamp
  groupId?: string;
  order: number; // 分组内的排序，升序
  isFavorite: boolean;
  isValid: boolean; // 路径是否仍然存在
}

interface GroupItem {
  id: string;
  name: string;
  parentId?: string; // 支持多级嵌套
  order: number; // 升序排列
  isSystem?: boolean; // 系统分组标记，不可删除
  isHidden?: boolean; // 是否隐藏
}

interface ProjectData {
  version: number; // 数据版本号，用于迁移
  projects: ProjectItem[];
  groups: GroupItem[];
}
```

### 项目列表 View

Sidebar 中的主 TreeView，展示所有项目和分组。

**展示规则：**
- 未分组的项目显示在根级别
- 分组可展开/折叠，显示其下的项目和子分组
- 项目在分组内按 `order` 字段升序排列，支持拖拽手动调整
- 路径无效的项目用灰色文字 + 警告图标标记
- 图标使用 VS Code 内置 Codicon
- 双击项目项打开该项目（按 `openProjectMode` 设置的方式）

**内置"最近项目"分组：**
- 虚拟视图，不通过 `groupId` 关联，而是按 `lastOpenedAt` 降序取前 N 条自动生成
- 不受拖拽影响，始终反映最近打开的项目
- 默认展开，显示在列表最顶部
- 项目数量受配置项 `projectExplorer.recentProjectsLimit` 限制（默认 20）
- 超过数量限制时自动隐藏最旧的条目
- 可通过右键菜单"隐藏"该分组，不可删除
- 隐藏后可通过设置 `projectExplorer.showRecentGroup` 重新显示

**图标方案：**

| 类型 | 图标 | Codicon |
|------|------|---------|
| 项目 | 文件夹图标 | `codicon-folder` |
| 无效项目 | 警告文件夹 | `codicon-folder` + 灰色文字 |
| 分组 | 分组图标 | `codicon-symbol-folder` |
| 最近项目分组 | 时钟图标 | `codicon-history` |
| 收藏项目 | 星标 | `codicon-star-full` |

**View Title Actions：**

- **打开项目** — 弹出 QuickPick 询问"在当前窗口打开"或"在新窗口打开"，然后弹出文件夹选择器，选择后直接打开该项目
- **新建项目** (`+`) — 先弹出 QuickPick 询问"在当前窗口打开"或"在新窗口打开"，然后弹出文件夹选择器，选择完成后将项目添加到列表并立即打开
- **Git Clone** — 先弹出输入框输入仓库 URL，然后弹出文件夹选择器选择克隆目标路径，克隆完成后将项目添加到列表，并询问在当前窗口或新窗口打开
- **新建分组** — 弹出输入框输入分组名称，在根级别创建新分组
- **折叠/展开** — 切换所有分组的折叠状态
- **清理无效项目** — 弹出确认框，一键移除所有标记为无效的项目
- **设置** (`gear`) — 打开扩展设置

**快捷键 QuickOpen：**
- 命令 `project-explorer.quickOpen`，默认绑定快捷键 `Alt+O`
- 弹出 QuickPick 列出所有项目（按 `lastOpenedAt` 降序），支持模糊搜索
- 选中后按 `openProjectMode` 设置的方式打开项目
- 列表项显示项目名称和路径

**拖拽排序：**
- 支持拖拽项目调整顺序
- 支持拖拽项目到分组中
- 支持拖拽分组调整顺序
- 支持拖拽分组嵌套到其他分组中
- 从"最近项目"分组拖拽项目到外部视作**复制**（原分组内保留，外部新增一条记录）
- 不允许将项目拖拽进入"最近项目"分组（该分组内容由系统自动维护）
- 不允许将分组拖入自己的子分组中（防止循环嵌套）

**右键菜单：**

| 菜单项 | 项目 | 分组 | 说明 |
|--------|------|------|------|
| 在新窗口打开 | ✅ | - | 使用 `vscode.openFolder` 打开项目 |
| 在当前窗口打开 | ✅ | - | 替换当前工作区 |
| 在资源管理器中显示 | ✅ | - | 调用系统资源管理器定位路径 |
| 收藏/取消收藏 | ✅ | - | 切换收藏状态 |
| 重命名 | ✅ | ✅ | 弹出输入框修改名称 |
| 删除 | ✅ | ✅ | 弹出确认框后删除。分组下有项目时弹出选项：移至上级 / 一并删除；根级分组则移至未分组 |

### 收藏列表 View

独立的 TreeView，仅显示被收藏的项目。

- 显示所有 `isFavorite: true` 的项目
- 点击项目与项目列表行为一致
- 右键菜单同项目列表（不包含分组相关操作）

### 分组管理

- 支持多级嵌套，形成树状结构
- 新建分组：右键菜单或 View Title Actions 中添加
- 分组内可包含项目和子分组
- 删除分组时：提示是否将子项移动到上级或一并删除
- 系统分组（如"最近项目"）不可删除，仅可隐藏

## 扩展设置

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `projectExplorer.recentProjectsLimit` | `number` | `20` | 最近项目分组显示的最大项目数 |
| `projectExplorer.showRecentGroup` | `boolean` | `true` | 是否显示"最近项目"分组 |
| `projectExplorer.openProjectMode` | `enum` | `"ask"` | 打开项目方式：`"ask"` 每次询问 / `"currentWindow"` 始终当前窗口 / `"newWindow"` 始终新窗口 |

### 无效项目检测

- 扩展启动时，检查最近 N 条（N = `recentProjectsLimit`）项目的路径是否存在
- 点击"清理无效项目"时，遍历所有项目检查路径是否存在
- 不存在的项目标记为 `isValid: false`，在列表中灰色显示
- 弹出确认框列出所有无效项目，用户确认后批量删除

## 国际化 (i18n)

支持英文和中文两个语言，跟随 VS Code 显示语言自动切换。

**方案：使用 VS Code 官方 `nls` 机制**

- 通过 `package.nls.json` 和 `package.nls.zh-cn.json` 实现 `package.json` 中的命令、设置、视图标题等文本的本地化
- 扩展内部字符串（QuickPick 选项、提示信息等）通过 `vscode.l10n` API 实现本地化
- `package.json` 中使用 `%key%` 占位符引用 nls 文件中的翻译

**nls 文件结构：**

```
package.nls.json          # 英文（默认）
package.nls.zh-cn.json    # 中文简体
```

**README：**

```
README.md          # 英文版（默认），包含中文版链接
README.zh-cn.md    # 中文简体版，包含英文版链接
```

## 激活方式

使用 `onStartupFinished` 激活事件，VS Code 启动完成后自动激活扩展，开始记录当前工作区。

## package.json contributes 配置概要

```jsonc
{
  "activationEvents": ["onStartupFinished"],
  "contributes": {
    "viewsContainers": {
      "activitybar": [{
        "id": "project-explorer",
        "title": "Project Explorer",
        "icon": "resources/icon.svg"
      }]
    },
    "views": {
      "project-explorer": [
        {
          "id": "project-explorer.projects",
          "name": "Projects",
          "icon": "resources/icon.svg"
        },
        {
          "id": "project-explorer.favorites",
          "name": "Favorites"
        }
      ]
    },
    "commands": [
      // 新建项目、新建分组、折叠/展开、清理无效项目
      // 右键：新窗口打开、当前窗口打开、资源管理器中显示
      // 右键：收藏/取消收藏、重命名、删除
    ],
    "menus": {
      "view/title": [...],
      "view/item/context": [...]
    }
  }
}
```

## 文件结构规划

```
src/
  extension.ts          # 入口，激活/停用
  providers/
    projectTreeProvider.ts    # 项目列表 TreeDataProvider
    favoriteTreeProvider.ts   # 收藏列表 TreeDataProvider
  models/
    project.ts           # ProjectItem 类型定义
    group.ts             # GroupItem 类型定义
    storage.ts           # ProjectData 类型定义
  services/
    storageService.ts    # globalState 读写
    projectService.ts    # 项目 CRUD 和自动记录逻辑
    groupService.ts      # 分组 CRUD 和嵌套管理
  commands/
    projectCommands.ts   # 项目相关命令注册
    groupCommands.ts     # 分组相关命令注册
  utils/
    validator.ts         # 路径有效性检测等工具函数
package.nls.json         # 英文翻译（默认）
package.nls.zh-cn.json   # 中文简体翻译
README.md                # 英文文档
README.zh-cn.md          # 中文文档
```
