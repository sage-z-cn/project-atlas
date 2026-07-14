import * as vscode from "vscode";
import type { TodoItem, TodoTag } from "../models/todo";

/**
 * Todo 扫描器：从源码文件中提取 TODO/FIXME/XXX/HACK/BUG/NOTE 标注。
 *
 * 两阶段正则：
 *   阶段1（行级粗筛）：匹配行注释起始 + 标签词，命中后进阶段2。
 *   阶段2（元数据提取）：从标签词位置解析 assignee/priority/text。
 *
 * findFiles 用 include glob 限定源码扩展名白名单，exclude 合并配置 globs。
 * relativePath 用 vscode.workspace.asRelativePath 后转正斜杠，保证跨端一致。
 */

/** 扫描目标源码扩展名白名单（与 include glob 保持同步）。 */
const SOURCE_EXTENSIONS = new Set([
  "ts", "js", "tsx", "jsx", "py", "go", "rs", "java", "c", "cpp", "h", "hpp",
  "cs", "rb", "php", "swift", "kt", "dart", "vue", "svelte", "scss", "css",
  "sh", "bat", "ps1",
]);

/** include glob：覆盖常见源码文件。 */
const INCLUDE_GLOB = "**/*.{ts,js,tsx,jsx,py,go,rs,java,c,cpp,h,hpp,cs,rb,php,swift,kt,dart,vue,svelte,scss,css,sh,bat,ps1}";

export interface ScanOptions {
  /** 标签词白名单（动态构建阶段1正则）。 */
  tags: TodoTag[];
  /** exclude glob 列表，合并后传给 findFiles。 */
  excludeGlobs: string[];
  workspaceFolders: readonly vscode.WorkspaceFolder[];
}

export interface ScanResult {
  todos: TodoItem[];
  byFile: Map<string, TodoItem[]>;
  elapsed: number;
}

export interface TodoScanner {
  scanAll(options: ScanOptions): Promise<ScanResult>;
  scanFile(fileUri: vscode.Uri, options: ScanOptions): TodoItem[];
}

/** 默认 exclude globs（与 TodoService 默认值同步，watcher 过滤用）。 */
const DEFAULT_EXCLUDES = [
  "**/node_modules/**",
  "**/.git/**",
  "**/dist/**",
  "**/out/**",
  "**/build/**",
  "**/.vscode-test/**",
  "**/*.min.js",
  "**/*.map",
];

/**
 * 将简单 glob 转为正则。支持 `**`（跨目录任意字符）、`*`（单层任意非分隔）、
 * `?`（单字符）及其它字符的字面转义。用于 exclude 匹配，无需引入 minimatch 依赖。
 */
function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      re += ".*";
      i++;
      // 吃掉可能紧跟的 /
      if (glob[i + 1] === "/") i++;
    } else if (c === "*") {
      re += "[^/]*";
    } else if (c === "?") {
      re += "[^/]";
    } else if (/[.+^${}()|[\]\\]/.test(c)) {
      re += "\\" + c;
    } else {
      re += c;
    }
  }
  return new RegExp(`^${re}$`);
}

/** 缓存 glob→RegExp，避免每次 isScanTarget 调用都重编译。 */
let excludeCache: { globs: string[]; regexes: RegExp[] } | undefined;

function getExcludeRegexes(): RegExp[] {
  const cfg = vscode.workspace.getConfiguration("todoAtlas.scan");
  const globs = cfg.get<string[]>("exclude", DEFAULT_EXCLUDES);
  if (!excludeCache || excludeCache.globs !== globs) {
    excludeCache = { globs, regexes: globs.map(globToRegExp) };
  }
  return excludeCache.regexes;
}

/**
 * 判断 uri 是否为扫描目标：扩展名在白名单内 且 不在 exclude globs 内。
 * 用于 watcher 过滤——避免对 node_modules/dist 等保存事件触发重扫。
 * exclude 读取 todoAtlas.scan.exclude 配置（默认见 DEFAULT_EXCLUDES）。
 */
export function isScanTarget(uri: vscode.Uri): boolean {
  const ext = uri.path.split(".").pop()?.toLowerCase();
  if (!ext || !SOURCE_EXTENSIONS.has(ext)) return false;
  const rel = toRelativeForwardSlash(uri);
  for (const re of getExcludeRegexes()) {
    if (re.test(rel)) return false;
  }
  return true;
}

/** 转义单个标签词以安全嵌入正则字符类外的分组。 */
function escapeTag(tag: string): string {
  return tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 构建两阶段正则。阶段1动态用 options.tags 构建 `(TAG1|TAG2|...)`。
 * 返回 [phase1, phase2]。
 */
function buildRegexes(tags: TodoTag[]): [RegExp, RegExp] {
  const tagGroup = tags.map(escapeTag).join("|");
  // 阶段1：行级粗筛。匹配行注释起始符号（// # <!-- ; /* *）+ 标签词边界。
  const phase1 = new RegExp(
    `(\\/\\/|#|<!--|;|\\/\\*|^|\\*)\\s*(${tagGroup})\\b`,
    "i",
  );
  // 阶段2：元数据提取。从标签词位置解析 assignee / priority / text。
  const phase2 = new RegExp(
    `(?<tag>${tagGroup})\\s*(?:\\((?<assignee>[^)]+)\\))?\\s*(?:\\[(?<priority>p[12])\\])?\\s*:?\\s*(?<text>.*)$`,
    "i",
  );
  return [phase1, phase2];
}

/** priority 映射：p1→high, p2→medium, 无→undefined。 */
function mapPriority(p: string | undefined): "high" | "medium" | undefined {
  if (p === "p1") return "high";
  if (p === "p2") return "medium";
  return undefined;
}

/** 去除尾部注释结束符（星号斜杠 / 箭头）并 trim。 */
function cleanText(raw: string): string {
  return raw
    .replace(/\*\/\s*$/, "")
    .replace(/-->\s*$/, "")
    .trim();
}

/** 大写化标签词以匹配 TodoTag 联合类型。 */
function normalizeTag(raw: string): TodoTag {
  return raw.toUpperCase() as TodoTag;
}

/**
 * 解析单个 TextDocument，提取 TodoItem[]。
 * line/column 为 1-based。
 */
function extractTodos(
  content: string,
  fileUri: vscode.Uri,
  [phase1, phase2]: [RegExp, RegExp],
): TodoItem[] {
  const lines = content.split(/\r?\n/);
  const results: TodoItem[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m1 = phase1.exec(line);
    if (!m1) continue;

    // 阶段2 从 phase1 命中的标签词位置开始跑（避免误匹配行内字符串字面量
    // 中早于注释的标签词）。m1[2] 是标签分组；其起始 = 整体匹配末尾 - 标签长度。
    const tagLen = m1[2]?.length ?? 0;
    const tagStart = (m1.index ?? 0) + m1[0].length - tagLen;
    const m2 = phase2.exec(line.slice(tagStart));
    if (!m2) continue;

    const tagRaw = (m2.groups?.tag ?? m1[2] ?? "").toString();
    if (!tagRaw) continue;

    const text = cleanText((m2.groups?.text ?? "").toString());
    if (!text) continue;

    const assignee = (m2.groups?.assignee ?? "").toString() || undefined;
    const priority = mapPriority((m2.groups?.priority ?? "").toString() || undefined);

    // column = 标签词在行中的字符偏移 + 1（1-based）。m2.index 在 slice 后为 0。
    const column = tagStart + (m2.index ?? 0) + 1;
    const relativePath = toRelativeForwardSlash(fileUri);

    results.push({
      id: `scan::${relativePath}::${i + 1}::${column}`,
      source: "scan",
      status: "pending",
      text,
      tag: normalizeTag(tagRaw),
      priority,
      file: fileUri.fsPath,
      relativePath,
      line: i + 1,
      column,
      assignee,
    });
  }

  return results;
}

/** 相对工作区根的正斜杠路径。多根工作区时 asRelativePath 返回 folder 名前缀路径。 */
function toRelativeForwardSlash(uri: vscode.Uri): string {
  const rel = vscode.workspace.asRelativePath(uri, false);
  return rel.split(/[\\/]/).join("/");
}

/** 合并 exclude globs 为 findFiles 接受的单个 glob 字符串（{a,b,c} 语法）。 */
function mergeExcludes(excludeGlobs: string[]): string {
  if (excludeGlobs.length === 0) return "";
  if (excludeGlobs.length === 1) return excludeGlobs[0];
  return `{${excludeGlobs.join(",")}}`;
}

export class NodeFsScanner implements TodoScanner {
  async scanAll(options: ScanOptions): Promise<ScanResult> {
    const start = Date.now();
    const { tags, excludeGlobs, workspaceFolders } = options;

    if (!workspaceFolders || workspaceFolders.length === 0) {
      return { todos: [], byFile: new Map(), elapsed: 0 };
    }

    const regexes = buildRegexes(tags.length > 0 ? tags : (["TODO"] as TodoTag[]));
    const exclude = mergeExcludes(excludeGlobs);

    // 收集所有匹配文件（跨多根工作区，去重）。
    const allUris: vscode.Uri[] = [];
    const seen = new Set<string>();
    for (const folder of workspaceFolders) {
      const pattern = new vscode.RelativePattern(folder, INCLUDE_GLOB);
      const uris = await vscode.workspace.findFiles(pattern, exclude || undefined);
      for (const uri of uris) {
        const key = uri.toString();
        if (!seen.has(key)) {
          seen.add(key);
          allUris.push(uri);
        }
      }
    }

    const byFile = new Map<string, TodoItem[]>();
    const todos: TodoItem[] = [];

    for (const uri of allUris) {
      try {
        const doc = await vscode.workspace.openTextDocument(uri);
        const items = extractTodos(doc.getText(), uri, regexes);
        if (items.length > 0) {
          byFile.set(uri.fsPath, items);
          todos.push(...items);
        }
      } catch {
        // 打开/读取失败跳过（二进制、编码、权限等）。
      }
    }

    return { todos, byFile, elapsed: Date.now() - start };
  }

  scanFile(fileUri: vscode.Uri, options: ScanOptions): TodoItem[] {
    const { tags } = options;
    const regexes = buildRegexes(tags.length > 0 ? tags : (["TODO"] as TodoTag[]));
    const doc = vscode.workspace.textDocuments.find(
      (d) => d.uri.toString() === fileUri.toString(),
    );
    if (!doc) return [];
    return extractTodos(doc.getText(), fileUri, regexes);
  }
}
