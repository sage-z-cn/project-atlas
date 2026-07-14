/**
 * Todo Atlas 数据模型。
 *
 * 扁平结构 + source 鉴别字段（不用 discriminated union）。手动 todo 持久化到
 * globalState（经 TodoService），扫描 todo 仅存在于内存缓存（每次扫描重建）。
 *
 * ID 策略（跨端一致，webview 端依赖此格式做 source/scope 分流）：
 *   - 手动全局: `manual::global::<uuid>`
 *   - 手动项目: `manual::project::<workspaceIdHash>::<uuid>`
 *   - 扫描:     `scan::<relativePath>::<line>::<column>`
 */

export type TodoScope = "global" | "project";

/** 来源：手动添加 或 代码扫描。 */
export type TodoSource = "manual" | "scan";

export type TodoStatus = "pending" | "completed";

/** 扫描支持的标签词（可由配置自定义子集）。 */
export type TodoTag = "TODO" | "FIXME" | "XXX" | "HACK" | "BUG" | "NOTE";

export type TodoPriority = "high" | "medium" | "low";

export interface TodoItem {
  id: string;
  source: TodoSource;
  /** 仅手动 todo 有意义：global / project。扫描 todo 不设此字段。 */
  scope?: TodoScope;
  /** 仅 project 手动 todo：所属工作区 uri.toString()。 */
  workspaceId?: string;
  status: TodoStatus;
  createdAt?: number;
  updatedAt?: number;
  completedAt?: number;
  /** 正文（扫描 todo 已 trim 并去除尾部注释结束符）。 */
  text: string;
  tag?: TodoTag;
  priority?: TodoPriority;
  /** 绝对路径（扫描 todo）。 */
  file?: string;
  /** 相对工作区根的正斜杠路径（扫描 todo）。 */
  relativePath?: string;
  /** 1-based 行号（扫描 todo）。 */
  line?: number;
  /** 1-based 列号（扫描 todo）。 */
  column?: number;
  /** 解析自 `TODO(name)` 注解（扫描 todo）。 */
  assignee?: string;
}

/**
 * TodoService 持久化结构（globalState key "todoAtlas.data"）。
 * 扫描 todo 不落盘，仅存内存缓存。
 */
export interface TodoStoreData {
  version: number;
  /** scope=global 的手动 todo。 */
  global: TodoItem[];
  /** scope=project 的手动 todo，按 workspaceId 分桶。 */
  projects: Record<string, TodoItem[]>;
}
