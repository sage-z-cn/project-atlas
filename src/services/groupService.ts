import type { GroupItem } from "../models/group";
import { StorageService } from "./storageService";
import { generateId } from "../utils/validator";

export class GroupService {
  constructor(private storage: StorageService) {}

  getAll(): GroupItem[] {
    return this.storage.getData().groups;
  }

  getById(id: string): GroupItem | undefined {
    return this.getAll().find((g) => g.id === id);
  }

  getRootGroups(): GroupItem[] {
    return this.getAll()
      .filter((g) => !g.parentId && !g.isHidden)
      .sort((a, b) => a.order - b.order);
  }

  getChildren(parentId: string): GroupItem[] {
    return this.getAll()
      .filter((g) => g.parentId === parentId && !g.isHidden)
      .sort((a, b) => a.order - b.order);
  }

  isDescendant(groupId: string, potentialAncestorId: string): boolean {
    const all = this.getAll();
    let current = all.find((g) => g.id === groupId);
    while (current?.parentId) {
      if (current.parentId === potentialAncestorId) {return true;}
      current = all.find((g) => g.id === current!.parentId);
    }
    return false;
  }

  addGroup(name: string, parentId?: string): Thenable<GroupItem> {
    const siblings = parentId
      ? this.getChildren(parentId)
      : this.getRootGroups();

    const group: GroupItem = {
      id: generateId(),
      name,
      parentId,
      order: siblings.length,
    };

    return this.storage
      .updateData((data) => ({
        ...data,
        groups: [...data.groups, group],
      }))
      .then(() => group);
  }

  deleteGroup(id: string, moveChildren: boolean): Thenable<void> {
    return this.storage.updateData((data) => {
      const group = data.groups.find((g) => g.id === id);
      if (!group) {return data;}

      const descendantIds = this.getDescendantIds(id, data.groups);
      const newParentId = group.parentId || undefined;

      let projects = data.projects;
      let groups = data.groups;

      if (moveChildren) {
        const allIds = new Set([id, ...descendantIds]);
        projects = projects.map((p) =>
          allIds.has(p.groupId || "") ? { ...p, groupId: newParentId } : p
        );
        groups = groups.map((g) =>
          g.parentId === id ? { ...g, parentId: newParentId } : g
        );
      } else {
        const allIds = new Set([id, ...descendantIds]);
        projects = projects.filter((p) => !p.groupId || !allIds.has(p.groupId));
        groups = groups.filter((g) => !allIds.has(g.id));
      }

      groups = groups.filter((g) => g.id !== id);

      return { ...data, projects, groups };
    });
  }

  renameGroup(id: string, newName: string): Thenable<void> {
    return this.storage.updateData((data) => ({
      ...data,
      groups: data.groups.map((g) =>
        g.id === id ? { ...g, name: newName } : g
      ),
    }));
  }

  hideGroup(id: string): Thenable<void> {
    return this.storage.updateData((data) => ({
      ...data,
      groups: data.groups.map((g) =>
        g.id === id ? { ...g, isHidden: true } : g
      ),
    }));
  }

  showGroup(id: string): Thenable<void> {
    return this.storage.updateData((data) => ({
      ...data,
      groups: data.groups.map((g) =>
        g.id === id ? { ...g, isHidden: false } : g
      ),
    }));
  }

  updateOrder(id: string, order: number): Thenable<void> {
    return this.storage.updateData((data) => ({
      ...data,
      groups: data.groups.map((g) =>
        g.id === id ? { ...g, order } : g
      ),
    }));
  }

  updateParent(id: string, parentId: string | undefined): Thenable<void> {
    return this.storage.updateData((data) => ({
      ...data,
      groups: data.groups.map((g) =>
        g.id === id ? { ...g, parentId } : g
      ),
    }));
  }

  private getDescendantIds(id: string, groups: GroupItem[]): string[] {
    const children = groups.filter((g) => g.parentId === id);
    const ids: string[] = [];
    for (const child of children) {
      ids.push(child.id);
      ids.push(...this.getDescendantIds(child.id, groups));
    }
    return ids;
  }
}
