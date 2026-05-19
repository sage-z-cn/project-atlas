import * as path from "path";
import type { ProjectItem } from "../models/project";
import { StorageService } from "./storageService";
import { generateId, getWorkspaceName, getWorkspacePath, isPathValid, normalizePath } from "../utils/validator";
import { detectProjectType } from "../utils/projectTypeDetector";

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
      const projectType = detectProjectType(wsPath);
      return this.storage.updateData((data) => ({
        ...data,
        recentProjects: data.recentProjects.map((p) =>
          p.id === existing.id
            ? { ...p, lastOpenedAt: Date.now(), projectType: projectType.type }
            : p
        ),
        favoriteProjects: data.favoriteProjects.map((p) =>
          p.path === wsPath ? { ...p, projectType: projectType.type } : p
        ),
      }));
    }

    const projectType = detectProjectType(wsPath);
    const project: ProjectItem = {
      id: generateId(),
      name: getWorkspaceName(),
      path: wsPath,
      lastOpenedAt: Date.now(),
      order: this.getAll().length,
      isFavorite: false,
      isValid: true,
      projectType: projectType.type,
    };

    return this.storage.updateData((data) => ({
      ...data,
      recentProjects: [...data.recentProjects, project],
    }));
  }

  addProject(p: string, name?: string): Thenable<ProjectItem> {
    p = normalizePath(p);
    const existing = this.getByPath(p);
    if (existing) {
      const projectType = detectProjectType(p);
      return this.storage
        .updateData((data) => ({
          ...data,
          recentProjects: data.recentProjects.map((proj) =>
            proj.id === existing.id
              ? { ...proj, lastOpenedAt: Date.now(), projectType: projectType.type }
              : proj
          ),
          favoriteProjects: data.favoriteProjects.map((proj) =>
            proj.path === p ? { ...proj, projectType: projectType.type } : proj
          ),
        }))
        .then(() => existing);
    }

    const projectType = detectProjectType(p);
    const project: ProjectItem = {
      id: generateId(),
      name: name || path.basename(p),
      path: p,
      lastOpenedAt: Date.now(),
      order: this.getAll().length,
      isFavorite: false,
      isValid: true,
      projectType: projectType.type,
    };

    return this.storage
      .updateData((data) => ({
        ...data,
        recentProjects: [...data.recentProjects, project],
      }))
      .then(() => project);
  }

  removeProject(id: string): Thenable<void> {
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

  checkValidity(): Thenable<ProjectItem[]> {
    const data = this.storage.getData();

    const cache = new Map<string, boolean>();
    for (const p of data.recentProjects) {
      cache.set(p.id, isPathValid(p.path));
    }

    const changed = data.recentProjects.filter((p) => cache.get(p.id) !== p.isValid);
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
        recentProjects: data.recentProjects
          .map((p) => ({ ...p, isValid: isPathValid(p.path) }))
          .filter((p) => p.isValid),
      }))
      .then(() => before - this.getAll().length);
  }
}
