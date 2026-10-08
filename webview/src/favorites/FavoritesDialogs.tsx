import { t } from "../shared/i18n";
import {
  findTreeNode,
  useFavoritesStore,
} from "../shared/store/favorites-store";
import { PromptDialog } from "../shared/components/PromptDialog";
import { ConfirmDialog } from "../shared/components/ConfirmDialog";

/**
 * Favorites 视图的输入 / 确认弹窗集合（重命名、新建子分组、移除收藏、
 * 删除分组、非空组二选一），由 favorites-store 的 dialog 状态驱动，
 * 常驻视图顶层。文案按 kind 在此派生，store 只存纯数据。
 * 取消 / Escape / 遮罩一律中止（cancelFavoritesDialog），不发请求。
 */
export function FavoritesDialogs() {
  const dialog = useFavoritesStore((s) => s.dialog);
  const tree = useFavoritesStore((s) => s.tree);
  const resolveFavoritesInput = useFavoritesStore((s) => s.resolveFavoritesInput);
  const confirmFavoritesDialog = useFavoritesStore((s) => s.confirmFavoritesDialog);
  const chooseDeleteGroupStrategy = useFavoritesStore(
    (s) => s.chooseDeleteGroupStrategy,
  );
  const cancelFavoritesDialog = useFavoritesStore((s) => s.cancelFavoritesDialog);

  if (!dialog) return null;

  switch (dialog.kind) {
    case "renameFavorite":
      return (
        <PromptDialog
          title={t("Rename project")}
          label={t("Enter new name:")}
          initialValue={dialog.initialValue}
          confirmLabel={t("Rename")}
          onConfirm={(name) => void resolveFavoritesInput(name)}
          onCancel={cancelFavoritesDialog}
        />
      );
    case "addSubGroup":
      return (
        <PromptDialog
          title={t("Create Sub-group")}
          label={t("Enter sub-group name")}
          confirmLabel={t("Create")}
          onConfirm={(name) => void resolveFavoritesInput(name)}
          onCancel={cancelFavoritesDialog}
        />
      );
    case "renameGroup":
      return (
        <PromptDialog
          title={t("Rename Group")}
          label={t("Enter group name")}
          initialValue={dialog.initialValue}
          confirmLabel={t("Rename")}
          onConfirm={(name) => void resolveFavoritesInput(name)}
          onCancel={cancelFavoritesDialog}
        />
      );
    case "removeFavorites": {
      const single = dialog.ids.length === 1 ? findTreeNode(tree, dialog.ids[0]) : null;
      const message = single
        ? t("Are you sure you want to remove '{0}' from favorites?", single.name)
        : t("Are you sure you want to remove {0} selected items?", dialog.ids.length);
      return (
        <ConfirmDialog
          title={t("Remove from Favorites")}
          message={message}
          confirmLabel={t("Remove")}
          dontAsk
          onConfirm={(dontAsk) => void confirmFavoritesDialog(dontAsk)}
          onCancel={cancelFavoritesDialog}
        />
      );
    }
    case "deleteGroups": {
      const single = dialog.ids.length === 1 ? findTreeNode(tree, dialog.ids[0]) : null;
      const message = single
        ? t("Are you sure you want to delete group '{0}'?", single.name)
        : t("Are you sure you want to remove {0} selected items?", dialog.ids.length);
      return (
        <ConfirmDialog
          title={t("Delete Group")}
          message={message}
          confirmLabel={t("Delete")}
          dontAsk
          onConfirm={(dontAsk) => void confirmFavoritesDialog(dontAsk)}
          onCancel={cancelFavoritesDialog}
        />
      );
    }
    case "deleteGroupStrategy": {
      const node = findTreeNode(tree, dialog.id);
      return (
        <ConfirmDialog
          title={t("Delete Group")}
          message={t("Group '{0}' contains items. What would you like to do?", node?.name ?? "")}
          confirmLabel={t("Remove all from favorites")}
          altChoice={{
            label: t("Move to parent"),
            onChoose: () => void chooseDeleteGroupStrategy("moveToParent"),
          }}
          onConfirm={() => void chooseDeleteGroupStrategy("removeAll")}
          onCancel={cancelFavoritesDialog}
        />
      );
    }
  }
}
