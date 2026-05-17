import * as vscode from "vscode";
import type { ProjectData } from "../models/storage";

const STORAGE_KEY = "projectExplorer.data";

const DEFAULT_DATA: ProjectData = {
  version: 2,
  recentProjects: [],
  favoriteProjects: [],
  groups: [],
};

export class StorageService {
  private _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;
  private updateQueue: Promise<void> = Promise.resolve();

  constructor(private context: vscode.ExtensionContext) {}

  getData(): ProjectData {
    const raw = this.context.globalState.get<any>(STORAGE_KEY);
    if (!raw) {
      this.context.globalState.update(STORAGE_KEY, DEFAULT_DATA);
      return structuredClone(DEFAULT_DATA);
    }
    if (!raw.recentProjects) {
      const projects: any[] = raw.projects || [];
      raw.recentProjects = projects;
      raw.favoriteProjects = projects.filter((p: any) => p.isFavorite);
      delete raw.projects;
      this.context.globalState.update(STORAGE_KEY, raw);
    }
    return structuredClone(raw as ProjectData);
  }

  saveData(data: ProjectData): Thenable<void> {
    return this.context.globalState.update(STORAGE_KEY, data).then(() => {
      this._onDidChange.fire();
    });
  }

  updateData(updater: (data: ProjectData) => ProjectData): Thenable<void> {
    this.updateQueue = this.updateQueue.then(() => {
      const data = this.getData();
      return this.saveData(updater(data));
    }).catch((err) => {
      this.updateQueue = Promise.resolve();
      throw err;
    });
    return this.updateQueue;
  }
}
