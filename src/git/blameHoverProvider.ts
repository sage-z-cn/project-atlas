import * as path from "node:path";
import * as vscode from "vscode";
import type { RepoRegistry } from "./repoRegistry";
import { toForwardSlash } from "../utils/pathUtils";

/**
 * Configuration key (under `gitAtlas.*`) that toggles this provider.
 */
const CONFIG_KEY = "enableBlameHover";

/**
 * The command the hover link invokes. Declared in package.json and registered
 * in gitCommands.ts; kept as a constant so the link and the registration stay
 * in sync.
 */
const LOCATE_COMMAND = "git-atlas.locateCommit";

/**
 * Adds a "Locate in Git Atlas" command link to the editor hover at the end of
 * every line inside a known git repo, merging into VSCode's built-in git blame
 * hover card (the link renders right below the blame info).
 *
 * IMPORTANT: this does NOT modify the built-in git extension's hover. VSCode
 * merges hover contributions from every registered HoverProvider into one card,
 * so this link simply appears alongside the built-in blame info.
 *
 * Flow on each hover: resolve the owning repo (longest-prefix), run a
 * single-line `git blame` to get the line's commit hash, and render a trusted
 * command link carrying `[hash, repoPath]`. Clicking invokes
 * `git-atlas.locateCommit`, which switches to the owning repo, reveals the Git
 * Log panel, and broadcasts `focusCommit` so the panel scrolls to + selects the
 * commit (paging in more history if it sits beyond the first 200 loaded).
 *
 * A single-entry cache avoids re-running git blame while the pointer stays on
 * the same line (VSCode re-fires provideHover as the mouse moves).
 */
export class BlameHoverProvider implements vscode.HoverProvider {
  constructor(private readonly registry: RepoRegistry) {}

  private cacheKey: string | null = null;
  private cachedHash: string | null = null;

  async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<vscode.Hover | undefined> {
    if (document.uri.scheme !== "file") return;
    if (
      !vscode.workspace
        .getConfiguration("gitAtlas")
        .get<boolean>(CONFIG_KEY, true)
    ) {
      return;
    }
    // Mirror the built-in git blame hover's trigger threshold: only respond at
    // the END of the line. VSCode's built-in blame renders as an `after`
    // decoration in the trailing whitespace, and its hover only fires when the
    // cursor sits at the line's last column. Matching that threshold (plus the
    // line-end range below) keeps this hover's geometry identical to the
    // built-in one, so VSCode merges both into a single card — otherwise the
    // merged card's horizontal anchor (min startColumn across all hover parts)
    // would jump to column 0 and the card shifts/displays with scrollbars.
    const lineRange = document.lineAt(position.line).range;
    if (position.character !== lineRange.end.character) return;

    const repo = this.registry.findRepoForPath(document.uri.fsPath);
    if (!repo) return; // file lives outside every known repo
    const svc = this.registry.getService(repo.path);
    if (!svc) return;

    // Normalize to "/": git pathspecs and the cache key below expect
    // POSIX-style paths.
    const relativePath = toForwardSlash(
      path.relative(repo.path, document.uri.fsPath),
    );
    if (!relativePath) return; // repo root itself — nothing to blame
    const line = position.line + 1; // git blame is 1-based, Position.line is 0-based

    const key = `${repo.path}:${relativePath}:${line}`;
    let hash: string | null;
    if (key === this.cacheKey) {
      hash = this.cachedHash;
    } else {
      try {
        hash = await svc.blameLine(relativePath, line);
      } catch {
        return; // blame failed (binary, no history, etc.) — no link
      }
      this.cacheKey = key;
      this.cachedHash = hash;
    }
    if (!hash) return; // uncommitted line — nothing to locate

    const shortHash = hash.slice(0, 8);
    const args = encodeURIComponent(JSON.stringify([hash, repo.path]));
    const md = new vscode.MarkdownString(
      `[$(git-commit) ${vscode.l10n.t("Locate in Git Atlas")} \`${shortHash}\`](command:${LOCATE_COMMAND}?${args})`,
    );
    // Restrict trust to this single command so the link is allowed to fire but
    // arbitrary command: URIs from the markdown are still blocked.
    md.isTrusted = { enabledCommands: [LOCATE_COMMAND] };
    md.supportThemeIcons = true;
    // Use the SAME range shape as the built-in blame hover: a zero-width range
    // pinned to the line end (column MAX_SAFE_INTEGER, clamped by VSCode to the
    // real line width). This is critical for correct merging — the merged
    // card's horizontal anchor is the min of every hover part's startColumn, so
    // a whole-line range (column 0) drags the whole card to the line start and
    // breaks layout. This range keeps it pinned at the line end beside the blame
    // text, and stays in sync with the built-in hover's isValidForHoverAnchor
    // filtering so the two never split/flicker as the pointer moves.
    const lineEnd = new vscode.Position(position.line, Number.MAX_SAFE_INTEGER);
    return new vscode.Hover(md, new vscode.Range(lineEnd, lineEnd));
  }
}
