import * as vscode from "vscode";

/**
 * 生成 React webview 的 HTML。
 *
 * 适配 Project Atlas 构建产物布局：单 chunk 输出到 `out/webview/assets/main.js`
 * 与 `out/webview/assets/style.css`（由 webview/vite.config.ts 的 rollupOptions 配置保证）。
 *
 * 注意：React webview 使用 unplugin-icons（SVG 组件），不加载 codicon/devicon 字体 CSS。
 */
export function getGitWebviewHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  mode: string,
  extra?: Record<string, string>,
): string {
  const outUri = vscode.Uri.joinPath(extensionUri, "out", "webview");
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(outUri, "assets", "main.js"),
  );
  const styleUri = webview.asWebviewUri(
    vscode.Uri.joinPath(outUri, "assets", "style.css"),
  );
  const nonce = getNonce();

  const dataAttrs = [`data-mode="${escapeHtml(mode)}"`];
  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      dataAttrs.push(`data-${escapeHtml(key)}="${escapeHtml(value)}"`);
    }
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}' ${webview.cspSource}; font-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <link rel="stylesheet" href="${styleUri}">
  <title>Git Atlas</title>
</head>
<body>
  <div id="root" ${dataAttrs.join(" ")}></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

function getNonce(): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
