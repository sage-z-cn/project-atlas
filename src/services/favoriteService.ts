import * as path from "path";
import type { ProjectItem } from "../models/project";
import { StorageService } from "./storageService";
import { generateId, normalizePath } from "../utils/validator";
import { detectProjectType } from "../utils/projectTypeDetector";

export class FavoriteService {
  constructor(private storage: StorageService) {}

  getAll(): ProjectItem[] {
    return this.storage.getData().favoriteProjects;
  }

  getById(id: string): ProjectItem | undefined {
    return this.getAll().find((p) => p.id === id);
  }

  getByPath(p: string): ProjectItem | undefined {
    return this.getAll().find((proj) => proj.path === p);
  }

  getByGroup(groupId: string): ProjectItem[] {
    return this.getAll()
      .filter((p) => p.groupId === groupId)
      .sort((a, b) => a.order - b.order);
  }

  getUngrouped(): ProjectItem[] {
    return this.getAll()
      .filter((p) => !p.groupId)
      .sort((a, b) => a.order - b.order);
  }

  getNextOrder(groupId: string | undefined): number {
    const siblings = groupId ? this.getByGroup(groupId) : this.getUngrouped();
    return siblings.length > 0 ? Math.max(...siblings.map((s) => s.order)) + 1 : 0;
  }

  async add(project: { name: string; path: string }, groupId?: string): Promise<ProjectItem> {
    const normalizedPath = normalizePath(project.path);
    const existing = this.getByPath(normalizedPath);
    if (existing) {
      if (existing.groupId !== groupId) {
        await this.moveToGroup(existing.id, groupId);
      }
      return this.getById(existing.id)!;
    }

    const projectType = detectProjectType(normalizedPath);
    const item: ProjectItem = {
      id: generateId(),
      name: project.name,
      path: normalizedPath,
      lastOpenedAt: Date.now(),
      order: this.getNextOrder(groupId),
      isFavorite: true,
      isValid: true,
      projectType: projectType.type,
      groupId,
    };

    await this.storage.updateData((data) => ({
      ...data,
      favoriteProjects: [...data.favoriteProjects, item],
    }));
    return item;
  }

  remove(id: string): Thenable<void> {
    return this.storage.updateData((data) => ({
      ...data,
      favoriteProjects: data.favoriteProjects.filter((p) => p.id !== id),
    }));
  }

  rename(id: string, newName: string): Thenable<void> {
    return this.storage.updateData((data) => ({
      ...data,
      favoriteProjects: data.favoriteProjects.map((p) =>
        p.id === id ? { ...p, name: newName } : p
      ),
    }));
  }

  moveToGroup(id: string, groupId: string | undefined): Thenable<void> {
    return this.storage.updateData((data) => {
      const order = data.favoriteProjects
        .filter((p) => p.groupId === groupId)
        .reduce((max, p) => Math.max(max, p.order), -1) + 1;

      return {
        ...data,
        favoriteProjects: data.favoriteProjects.map((p) =>
          p.id === id ? { ...p, groupId, order } : p
        ),
      };
    });
  }

  reorderAfter(draggedId: string, targetId: string): Thenable<void> {
    if (draggedId === targetId) {return Promise.resolve();}
    return this.storage.updateData((data) => {
      const dragged = data.favoriteProjects.find((p) => p.id === draggedId);
      const target = data.favoriteProjects.find((p) => p.id === targetId);
      if (!dragged || !target) {return data;}

      const groupId = target.groupId;
      const siblings = data.favoriteProjects
        .filter((p) => p.groupId === groupId && p.id !== draggedId)
        .sort((a, b) => a.order - b.order);

      const targetIndex = siblings.findIndex((p) => p.id === targetId);
      siblings.splice(targetIndex, 0, { ...dragged, groupId });

      const orderMap = new Map<string, number>();
      siblings.forEach((p, i) => orderMap.set(p.id, i));

      return {
        ...data,
        favoriteProjects: data.favoriteProjects.map((p) => {
          const newOrder = orderMap.get(p.id);
          if (newOrder !== undefined) {
            return { ...p, order: newOrder, groupId };
          }
          return p;
        }),
      };
    });
  }
}
