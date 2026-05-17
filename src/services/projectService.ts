import * as path from "path";
import type { ProjectItem } from "../models/project";
import { StorageService } from "./storageService";
import { generateId, getWorkspaceName, getWorkspacePath, isPathValid } from "../utils/validator";

export class ProjectService {
  constructor(private storage: StorageService) {}

  getAll(): ProjectItem[] {
    return this.storage.getData().recentProjects;
  }

  getById(id: string): ProjectItem | undefined {
    return this.getAll().find((p) => p.id === id);
  }

  getByPath(p: string): ProjectItem | undefined {
    return this.getAll().find((proj) => proj.path === p);
  }

  getRecent(limit: number): ProjectItem[] {
    return [...this.getAll()]
      .filter((p) => p.isValid)
      .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
      .slice(0, limit);
  }

  recordCurrentWorkspace(): Thenable<void> {
    const wsPath = getWorkspacePath();
    if (!wsPath) {return Promise.resolve();}

    const existing = this.getByPath(wsPath);
    if (existing) {
      return this.storage.updateData((data) => ({
        ...data,
        recentProjects: data.recentProjects.map((p) =>
          p.id === existing.id ? { ...p, lastOpenedAt: Date.now() } : p
        ),
      }));
    }

    const project: ProjectItem = {
      id: generateId(),
      name: getWorkspaceName(),
      path: wsPath,
      lastOpenedAt: Date.now(),
      order: this.getAll().length,
      isFavorite: false,
      isValid: true,
    };

    return this.storage.updateData((data) => ({
      ...data,
      recentProjects: [...data.recentProjects, project],
    }));
  }

  addProject(p: string, name?: string): Thenable<ProjectItem> {
    const existing = this.getByPath(p);
    if (existing) {
      return this.storage
        .updateData((data) => ({
          ...data,
          recentProjects: data.recentProjects.map((proj) =>
            proj.id === existing.id ? { ...proj, lastOpenedAt: Date.now() } : proj
          ),
        }))
        .then(() => existing);
    }

    const project: ProjectItem = {
      id: generateId(),
      name: name || path.basename(p),
      path: p,
      lastOpenedAt: Date.now(),
      order: this.getAll().length,
      isFavorite: false,
      isValid: true,
    };

    return this.storage
      .updateData((data) => ({
        ...data,
        recentProjects: [...data.recentProjects, project],
      }))
      .then(() => project);
  }

  deleteProject(id: string): Thenable<void> {
    return this.storage.updateData((data) => ({
      ...data,
      recentProjects: data.recentProjects.filter((p) => p.id !== id),
    }));
  }

  renameProject(id: string, newName: string): Thenable<void> {
    return this.storage.updateData((data) => ({
      ...data,
      recentProjects: data.recentProjects.map((p) =>
        p.id === id ? { ...p, name: newName } : p
      ),
    }));
  }

  checkValidity(limit: number): Thenable<ProjectItem[]> {
    const data = this.storage.getData();
    const recent = [...data.recentProjects]
      .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
      .slice(0, limit);

    const cache = new Map<string, boolean>();
    for (const p of recent) {
      const valid = isPathValid(p.path);
      cache.set(p.id, valid);
    }

    const changed = recent.filter((p) => cache.get(p.id) !== p.isValid);
    if (changed.length === 0) {return Promise.resolve([]);}

    return this.storage
      .updateData((d) => ({
        ...d,
        recentProjects: d.recentProjects.map((p) => {
          const newValid = cache.get(p.id);
          return newValid !== undefined ? { ...p, isValid: newValid } : p;
        }),
      }))
      .then(() => changed);
  }

  cleanInvalid(): Thenable<number> {
    const before = this.getAll().length;
    return this.storage
      .updateData((data) => ({
        ...data,
        recentProjects: data.recentProjects.filter((p) => p.isValid),
      }))
      .then(() => before - this.getAll().length);
  }
}
