# Project Explorer

一个 VS Code 扩展，自动记录打开的项目，支持侧边栏树形视图一键切换、分组管理和拖拽排序。

[English](README.md)

## 功能

- **自动记录** — 在 VS Code 中打开项目时自动记录
- **快速切换** — 通过侧边栏或 `Alt+O` 快速选择打开项目
- **分组管理** — 将项目组织到嵌套分组中，支持拖拽排序
- **最近项目** — 虚拟分组显示最近打开的项目
- **收藏项目** — 将常用项目固定到独立的收藏视图
- **Git 克隆** — 从侧边栏克隆仓库并直接打开
- **国际化** — 支持英文和中文

## 命令

| 命令 | 说明 |
|------|------|
| `Alt+O` | 快速打开项目 |
| 打开项目 | 选择文件夹并打开 |
| 添加项目 | 添加项目到列表 |
| Git 克隆 | 克隆仓库并打开 |
| 新建分组 | 创建项目分组 |
| 清理无效项目 | 移除路径不存在的项目 |

## 设置

| 设置项 | 默认值 | 说明 |
|--------|--------|------|
| `projectExplorer.recentProjectsLimit` | `20` | 最近项目最大显示数量 |
| `projectExplorer.showRecentGroup` | `true` | 是否显示最近项目分组 |
| `projectExplorer.openProjectMode` | `"ask"` | 打开项目方式：ask / currentWindow / newWindow |

## 许可证

MIT
