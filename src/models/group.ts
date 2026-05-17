export interface GroupItem {
  id: string;
  name: string;
  parentId?: string;
  order: number;
  isHidden?: boolean;
}
