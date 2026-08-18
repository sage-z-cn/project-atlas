import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { bridge } from "../../shared/bridge";
import { Tooltip } from "../../shared/components/Tooltip";
import "../../shared/components/Tooltip.css";
import { t } from "../../shared/i18n";
import IconAdd from "~icons/codicon/add";
import IconCheck from "~icons/codicon/check";
import IconCopy from "~icons/codicon/copy";
import IconEdit from "~icons/codicon/edit";
import IconTrash from "~icons/codicon/trash";

interface RemoteInfo {
  name: string;
  url: string;
}

/** One form at a time: "add" creates a new remote, "edit" renames and/or
 *  changes the URL of the remote identified by `name`/`url` (originals). */
type RemoteFormState =
  | { mode: "add" }
  | { mode: "edit"; name: string; url: string };

export interface ManageRemotesDialogProps {
  onClose: () => void;
}

/** Custom checkbox matching commit panel style (see CreateBranchDialog). */
function Checkbox({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <span
      onClick={() => onChange(!checked)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 16,
        height: 16,
        borderRadius: 3,
        border: checked ? "none" : "1.5px solid var(--description-fg, #999)",
        background: checked
          ? "var(--vscode-checkbox-selectBackground, #3574f0)"
          : "var(--vscode-checkbox-background, transparent)",
        cursor: "pointer",
        flexShrink: 0,
        transition: "background 0.1s, border 0.1s",
      }}
    >
      {checked && (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path
            d="M2.5 6L5 8.5L9.5 3.5"
            stroke="var(--vscode-button-foreground, #fff)"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </span>
  );
}

/** Small inline icon button used for per-row actions (copy/edit/delete). */
function RowIconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip text={label}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 22,
          height: 22,
          border: "none",
          borderRadius: 4,
          background: "transparent",
          color: "var(--app-fg)",
          cursor: "pointer",
          opacity: 0.6,
          padding: 0,
          flexShrink: 0,
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLElement).style.opacity = "1";
          (e.currentTarget as HTMLElement).style.background =
            "var(--hover-bg)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.opacity = "0.6";
          (e.currentTarget as HTMLElement).style.background = "transparent";
        }}
      >
        {children}
      </button>
    </Tooltip>
  );
}

export function ManageRemotesDialog({ onClose }: ManageRemotesDialogProps) {
  const [remotes, setRemotes] = useState<RemoteInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<RemoteFormState | null>(null);
  const [nameValue, setNameValue] = useState("");
  const [urlValue, setUrlValue] = useState("");
  /** Whether the extension should fetch from the remote after a change.
   *  Shared by add/edit forms; reset to checked every time a form opens. */
  const [fetchRemote, setFetchRemote] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  /** Name of the remote whose row is in the inline delete-confirm state. */
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  /** Name of the remote whose URL was just copied — shows a check mark. */
  const [copiedRemote, setCopiedRemote] = useState<string | null>(null);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const backdropRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const urlInputRef = useRef<HTMLInputElement>(null);

  /** Refetch the remote list. Returns the fetched list, or null on failure
   *  (callers use it to reconcile form state against the real repo state). */
  const refresh = useCallback(async (): Promise<RemoteInfo[] | null> => {
    setLoading(true);
    setError(null);
    try {
      const result = (await bridge.request("getRemotes")) as {
        remotes?: RemoteInfo[];
      };
      const list = result?.remotes ?? [];
      setRemotes(list);
      return list;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setRemotes([]);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch remote list on mount
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Escape closes the form first when one is open, otherwise the dialog
  // (consistent with CreateBranchDialog).
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (form) {
          closeForm();
        } else {
          onClose();
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [form, onClose]);

  // Clear any pending "copied" timer on unmount
  useEffect(() => {
    return () => clearTimeout(copiedTimerRef.current);
  }, []);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === backdropRef.current) onClose();
    },
    [onClose],
  );

  const openAddForm = () => {
    setPendingDelete(null);
    setForm({ mode: "add" });
    setNameValue("");
    setUrlValue("");
    setFetchRemote(true);
    setError(null);
    requestAnimationFrame(() => nameInputRef.current?.focus());
  };

  const openEditForm = (remote: RemoteInfo) => {
    setPendingDelete(null);
    setForm({ mode: "edit", name: remote.name, url: remote.url });
    setNameValue(remote.name);
    setUrlValue(remote.url);
    setFetchRemote(true);
    setError(null);
    requestAnimationFrame(() => urlInputRef.current?.focus());
  };

  const closeForm = () => {
    setForm(null);
    setNameValue("");
    setUrlValue("");
  };

  const canSubmit =
    !!nameValue.trim() &&
    !/\s/.test(nameValue.trim()) &&
    !!urlValue.trim() &&
    !submitting;

  const handleSubmit = async () => {
    if (!form || !canSubmit) return;
    const name = nameValue.trim();
    const url = urlValue.trim();
    setSubmitting(true);
    setError(null);
    try {
      if (form.mode === "add") {
        await bridge.request("addRemote", { name, url, fetch: fetchRemote });
      } else {
        const nameChanged = name !== form.name;
        const urlChanged = url !== form.url;
        if (!nameChanged && !urlChanged) {
          closeForm();
          return;
        }
        // Only the LAST step of a multi-step chain carries the real fetch
        // state: fetching after rename alone would hit the old URL (often
        // the reason it's being changed) and fetch twice on name+url edits.
        if (nameChanged && urlChanged) {
          await bridge.request("renameRemote", {
            name: form.name,
            newName: name,
            fetch: false,
          });
          await bridge.request("setRemoteUrl", { name, url, fetch: fetchRemote });
        } else if (nameChanged) {
          await bridge.request("renameRemote", {
            name: form.name,
            newName: name,
            fetch: fetchRemote,
          });
        } else {
          await bridge.request("setRemoteUrl", { name, url, fetch: fetchRemote });
        }
      }
      closeForm();
      await refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // refresh() clears the error banner, so re-set the submit error after.
      const list = await refresh();
      setError(msg);
      // Reconcile the edit-form baseline against the real remote list —
      // never guess: if the original name still exists, rename failed and
      // the baseline is still correct. If the typed name exists instead,
      // rename succeeded and a later step failed — re-baseline to it.
      // If neither exists, keep the baseline and let the error guide the user.
      if (form.mode === "edit" && list) {
        if (!list.some((r) => r.name === form.name)) {
          const renamed = list.find((r) => r.name === name);
          if (renamed) {
            setForm({ mode: "edit", name: renamed.name, url: renamed.url });
          }
        }
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopyUrl = async (remote: RemoteInfo) => {
    try {
      await bridge.request("copyToClipboard", { text: remote.url });
      setError(null);
      setCopiedRemote(remote.name);
      clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = setTimeout(() => setCopiedRemote(null), 1500);
    } catch (err) {
      setCopiedRemote(null);
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleConfirmDelete = async (name: string) => {
    setDeleting(true);
    setError(null);
    try {
      await bridge.request("removeRemote", { name });
      setPendingDelete(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleting(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    flex: 1,
    background: "var(--input-bg)",
    color: "var(--input-fg)",
    border: "1px solid var(--input-border)",
    borderRadius: 4,
    padding: "4px 8px",
    fontSize: "var(--font-size)",
    fontFamily: "var(--font-family)",
    outline: "none",
    height: 28,
    boxSizing: "border-box",
    minWidth: 0,
  };

  const gridColumns = "110px 1fr 88px";

  return createPortal(
    <div
      ref={backdropRef}
      onClick={handleBackdropClick}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 99999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0, 0, 0, 0.4)",
      }}
    >
      <div
        style={{
          background: "var(--vscode-editorWidget-background, #252526)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          padding: "16px 20px",
          width: 900,
          maxWidth: "90vw",
          maxHeight: "70vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
          boxSizing: "border-box",
        }}
      >
        {/* Header: contextual title. The "Add Remote" entry point only shows
            in list mode; form mode keeps the title row free of buttons. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 12,
          }}
        >
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "var(--app-fg)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {form
              ? form.mode === "add"
                ? t("Add Remote")
                : t("Edit Remote")
              : t("Manage Remotes")}
          </div>
          <div style={{ flex: 1 }} />
          {!form && (
            <button
              type="button"
              onClick={openAddForm}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                background: "var(--button-bg)",
                color: "var(--button-fg)",
                border: "none",
                borderRadius: 4,
                padding: "4px 12px",
                fontSize: 12,
                height: 28,
                cursor: "pointer",
                flexShrink: 0,
              }}
            >
              <IconAdd width={13} height={13} />
              {t("Add Remote")}
            </button>
          )}
        </div>

        {/* Error Message */}
        {error && (
          <div
            style={{
              background:
                "var(--vscode-inputValidation-errorBackground, #5a1d1d)",
              border:
                "1px solid var(--vscode-inputValidation-errorBorder, #be1100)",
              borderRadius: 4,
              padding: "8px 10px",
              marginBottom: 12,
              fontSize: 12,
              color: "var(--error-fg)",
              lineHeight: 1.4,
            }}
          >
            {error}
          </div>
        )}

        {/* Form (add / edit) — replaces the list while open; only one form
            exists at a time. Stacked layout: labels above full-width inputs.
            Title + Cancel/submit live in the header row, not down here. */}
        {form ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 14,
              padding: "8px 0 4px",
              flexShrink: 0,
            }}
          >
            <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <span
                style={{
                  fontSize: 12,
                  color: "var(--description-fg)",
                }}
              >
                {t("Name")}
              </span>
              <input
                ref={nameInputRef}
                type="text"
                value={nameValue}
                onChange={(e) => setNameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && canSubmit) {
                    e.preventDefault();
                    void handleSubmit();
                  }
                }}
                placeholder="origin"
                spellCheck={false}
                autoComplete="off"
                style={inputStyle}
              />
            </label>

            <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <span
                style={{
                  fontSize: 12,
                  color: "var(--description-fg)",
                }}
              >
                {t("URL")}
              </span>
              <input
                ref={urlInputRef}
                type="text"
                value={urlValue}
                onChange={(e) => setUrlValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && canSubmit) {
                    e.preventDefault();
                    void handleSubmit();
                  }
                }}
                placeholder="https://example.com/repo.git"
                spellCheck={false}
                autoComplete="off"
                style={inputStyle}
              />
            </label>

            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 12,
                cursor: "pointer",
                userSelect: "none",
              }}
            >
              <Checkbox
                checked={fetchRemote}
                onChange={(v) => setFetchRemote(v)}
              />
              {t("Fetch Remote")}
            </label>
          </div>
        ) : (
          <>
        {/* Table header */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: gridColumns,
            alignItems: "center",
            gap: 8,
            padding: "2px 8px",
            fontSize: 11,
            fontWeight: 600,
            color: "var(--description-fg)",
            borderBottom: `1px solid var(--border)`,
            flexShrink: 0,
          }}
        >
          <div>{t("Name")}</div>
          <div style={{ overflow: "hidden" }}>{t("URL")}</div>
          <div />
        </div>

        {/* Remote list — scrolls when long, action column stays visible */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            margin: "0 -8px",
            padding: "0 8px",
          }}
        >
          {loading && (
            <div
              style={{
                padding: "16px 8px",
                fontSize: 12,
                color: "var(--description-fg)",
                textAlign: "center",
              }}
            >
              {t("Loading...")}
            </div>
          )}

          {!loading && remotes.length === 0 && (
            <div
              style={{
                padding: "16px 8px",
                fontSize: 12,
                color: "var(--description-fg)",
                textAlign: "center",
              }}
            >
              {t("No remotes found")}
            </div>
          )}

          {!loading &&
            remotes.map((remote) =>
              pendingDelete === remote.name ? (
                /* Inline delete confirmation — replaces the row content */
                <div
                  key={remote.name}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "5px 8px",
                    fontSize: 12,
                    background: "var(--hover-bg)",
                  }}
                >
                  <span style={{ color: "var(--error-fg)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {t("Delete remote '{0}'?", remote.name)}
                  </span>
                  <div style={{ flex: 1 }} />
                  <button
                    type="button"
                    onClick={() => setPendingDelete(null)}
                    style={{
                      background:
                        "var(--vscode-button-secondaryBackground, #3a3d41)",
                      color: "var(--vscode-button-secondaryForeground, var(--app-fg))",
                      border: "none",
                      borderRadius: 4,
                      padding: "2px 10px",
                      fontSize: 11,
                      height: 22,
                      cursor: "pointer",
                      flexShrink: 0,
                    }}
                  >
                    {t("Cancel")}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleConfirmDelete(remote.name)}
                    disabled={deleting}
                    style={{
                      background: "var(--error-fg)",
                      color: "#fff",
                      border: "none",
                      borderRadius: 4,
                      padding: "2px 10px",
                      fontSize: 11,
                      height: 22,
                      cursor: deleting ? "default" : "pointer",
                      opacity: deleting ? 0.5 : 1,
                      flexShrink: 0,
                    }}
                  >
                    {t("Delete")}
                  </button>
                </div>
              ) : (
                <div
                  key={remote.name}
                  className="selectable-row"
                  style={{
                    display: "grid",
                    gridTemplateColumns: gridColumns,
                    alignItems: "center",
                    gap: 8,
                    padding: "5px 8px",
                    fontSize: 12,
                    cursor: "default",
                  }}
                >
                  <div
                    title={remote.name}
                    style={{
                      fontWeight: 500,
                      color: "var(--app-fg)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {remote.name}
                  </div>
                  <div
                    title={remote.url}
                    style={{
                      color: "var(--description-fg)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      minWidth: 0,
                    }}
                  >
                    {remote.url}
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "flex-end",
                      gap: 2,
                    }}
                  >
                    <RowIconButton
                      label={
                        copiedRemote === remote.name
                          ? t("Copied")
                          : t("Copy URL")
                      }
                      onClick={() => void handleCopyUrl(remote)}
                    >
                      {copiedRemote === remote.name ? (
                        <IconCheck width={13} height={13} />
                      ) : (
                        <IconCopy width={13} height={13} />
                      )}
                    </RowIconButton>
                    <RowIconButton
                      label={t("Edit URL")}
                      onClick={() => openEditForm(remote)}
                    >
                      <IconEdit width={13} height={13} />
                    </RowIconButton>
                    <RowIconButton
                      label={t("Delete Remote")}
                      onClick={() => {
                        setForm(null);
                        setPendingDelete(remote.name);
                        setError(null);
                      }}
                    >
                      <IconTrash width={13} height={13} />
                    </RowIconButton>
                  </div>
                </div>
              ),
            )}
        </div>
        </>
        )}

        {/* Footer button row, right-aligned (same slot either mode):
            form mode → Cancel + Add/Save, list mode → Close. */}
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            alignItems: "center",
            gap: 8,
            marginTop: 12,
            flexShrink: 0,
          }}
        >
          {form ? (
            <>
              <button
                type="button"
                onClick={closeForm}
                style={{
                  background:
                    "var(--vscode-button-secondaryBackground, #3a3d41)",
                  color: "var(--vscode-button-secondaryForeground, var(--app-fg))",
                  border: "none",
                  borderRadius: 4,
                  padding: "4px 14px",
                  fontSize: 12,
                  height: 28,
                  cursor: "pointer",
                }}
              >
                {t("Cancel")}
              </button>
              <button
                type="button"
                onClick={() => void handleSubmit()}
                disabled={!canSubmit}
                style={{
                  background: "var(--button-bg)",
                  color: "var(--button-fg)",
                  border: "none",
                  borderRadius: 4,
                  padding: "4px 14px",
                  fontSize: 12,
                  height: 28,
                  cursor: canSubmit ? "pointer" : "default",
                  opacity: canSubmit ? 1 : 0.4,
                }}
              >
                {form.mode === "add" ? t("Add") : t("Save")}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={onClose}
              style={{
                background: "var(--vscode-button-secondaryBackground, #3a3d41)",
                color: "var(--vscode-button-secondaryForeground, var(--app-fg))",
                border: "none",
                borderRadius: 4,
                padding: "4px 14px",
                fontSize: 12,
                height: 28,
                cursor: "pointer",
              }}
            >
              {t("Close")}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
