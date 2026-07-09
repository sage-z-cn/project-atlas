import type { WorkingTreeFile } from "../../shared/store/commit-store";

export interface DirNode {
  name: string;
  fullPath: string;
  children: DirNode[];
  files: WorkingTreeFile[];
}

/** Build a directory tree from a flat file list (path uses "/" as separator). */
export function buildDirTree(files: WorkingTreeFile[]): DirNode {
  const root: DirNode = { name: "", fullPath: "", children: [], files: [] };

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
        };
        current.children.push(child);
      }
      current = child;
    }
    current.files.push(file);
  }

  // Compact single-child directories (src/git -> src/git)
  compactDirNode(root);
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

/** Collect all file keys (`path:staged`) recursively under a DirNode. */
export function collectFileKeys(node: DirNode): string[] {
  const keys: string[] = [];
  for (const file of node.files) {
    keys.push(`${file.path}:${file.staged}`);
  }
  for (const child of node.children) {
    keys.push(...collectFileKeys(child));
  }
  return keys;
}

/** Collect all WorkingTreeFile recursively under a DirNode. */
export function collectDirFiles(node: DirNode): WorkingTreeFile[] {
  const result: WorkingTreeFile[] = [...node.files];
  for (const child of node.children) {
    result.push(...collectDirFiles(child));
  }
  return result;
}

/** Count files (recursively) under a DirNode. */
export function countFiles(node: DirNode): number {
  let count = node.files.length;
  for (const child of node.children) {
    count += countFiles(child);
  }
  return count;
}
