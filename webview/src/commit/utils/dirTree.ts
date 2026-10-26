import type { WorkingTreeFile } from "../../shared/store/commit-store";

export interface DirNode {
  name: string;
  fullPath: string;
  /** Subdirectories, sorted by name at build time — callers must not re-sort. */
  children: DirNode[];
  files: WorkingTreeFile[];
  /** Recursive file count under this node, precomputed at build time. */
  fileCount: number;
  /** Recursive file keys (`path:staged`) under this node, precomputed at build time. */
  fileKeys: string[];
}

/** Build a directory tree from a flat file list (path uses "/" as separator).
 *  Children sorting and recursive fileCount/fileKeys are precomputed here so
 *  render paths never pay per-render `.slice().sort()` or recursive walks. */
export function buildDirTree(files: WorkingTreeFile[]): DirNode {
  const root: DirNode = {
    name: "",
    fullPath: "",
    children: [],
    files: [],
    fileCount: 0,
    fileKeys: [],
  };

  for (const file of files) {
    const parts = file.path.split("/");
    parts.pop(); // remove filename, we only need directory parts
    let current = root;

    for (const part of parts) {
      let child = current.children.find((c) => c.name === part);
      if (!child) {
        child = {
          name: part,
          fullPath: current.fullPath ? `${current.fullPath}/${part}` : part,
          children: [],
          files: [],
          fileCount: 0,
          fileKeys: [],
        };
        current.children.push(child);
      }
      current = child;
    }
    current.files.push(file);
  }

  // Compact single-child directories (src/git -> src/git)
  compactDirNode(root);
  // Sort children once + precompute recursive counts/keys
  prepareNode(root);
  return root;
}

/** Compact chains of single-child, fileless directories into one node. */
export function compactDirNode(node: DirNode) {
  for (const child of node.children) {
    while (child.children.length === 1 && child.files.length === 0) {
      const grandchild = child.children[0];
      child.name = `${child.name}/${grandchild.name}`;
      child.fullPath = grandchild.fullPath;
      child.children = grandchild.children;
      child.files = grandchild.files;
    }
    compactDirNode(child);
  }
}

/** Post-pass: sort each node's children by name and aggregate fileCount /
 *  fileKeys bottom-up, so consumers read them as plain fields. */
function prepareNode(node: DirNode) {
  node.children.sort((a, b) => a.name.localeCompare(b.name));
  const fileKeys = node.files.map((f) => `${f.path}:${f.staged}`);
  let fileCount = node.files.length;
  for (const child of node.children) {
    prepareNode(child);
    fileCount += child.fileCount;
    // 不用 spread push：函数参数个数有上限，单一巨大子树（10 万+ 文件）
    // 的 fileKeys 展开会抛 RangeError，逐个 push 不受该约束。
    for (const key of child.fileKeys) {
      fileKeys.push(key);
    }
  }
  node.fileCount = fileCount;
  node.fileKeys = fileKeys;
}

/** Collect all WorkingTreeFile recursively under a DirNode.
 *  On-demand only (context menus / batch buttons) — not for render paths. */
export function collectDirFiles(node: DirNode): WorkingTreeFile[] {
  const result: WorkingTreeFile[] = [...node.files];
  for (const child of node.children) {
    // 同 prepareNode：spread push 受参数上限约束，巨大子树会 RangeError。
    for (const file of collectDirFiles(child)) {
      result.push(file);
    }
  }
  return result;
}

/**
 * Collect fullPaths of every directory node (recursively) under a DirNode.
 * Keys match what the dir rows consume from `collapsedDirs` — must be
 * derived from a built (and compacted) tree, never from raw path prefixes.
 */
export function collectDirPaths(node: DirNode): string[] {
  const paths: string[] = [];
  for (const child of node.children) {
    paths.push(child.fullPath);
    // 同上：逐个 push，避免无界 spread 的参数上限。
    for (const p of collectDirPaths(child)) {
      paths.push(p);
    }
  }
  return paths;
}


/**
 * Scoped key for one collapsed directory inside a single file group.
 *
 * Changes and Staged Changes each render their own tree over overlapping
 * path names. Scoping the key by group keeps expand/collapse independent.
 *
 * group is the expandedGroups id (conflicts | changes | staged | unversioned);
 * VscodeGroupType merge is normalized to conflicts.
 */
export function dirCollapseKey(group: string, dirPath: string): string {
  return group + "::" + dirPath;
}
