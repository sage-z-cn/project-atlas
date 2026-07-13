import * as vscode from "vscode";

/**
 * 生成 React webview 的 HTML（通用，不绑定任何子系统）。
 *
 * 适配构建产物布局：单 chunk 输出到 `out/webview/assets/main.js`
 * 与 `out/webview/assets/style.css`（由 webview/vite.config.ts 的 rollupOptions
 * 配置保证：inlineDynamicImports + cssCodeSplit:false + 固定文件名）。
 *
 * 启动信号：`<div id="root">` 上的 `data-mode` + `data-*`（extra）属性。webview
 * 入口（webview/src/main.tsx）读取 `root.dataset.mode` 分发到对应根组件。
 *
 * 注意：React webview 使用 unplugin-icons（SVG 组件），不加载 codicon/devicon
 * 字体 CSS，因此 CSP 的 font-src 仅作兜底。
 *
 * CSP 说明：`style-src` 含 `'unsafe-inline'` 是为 React 内联样式（emotion /
* 内联 style 属性）让路；`script-src` 仍用 nonce 严格限制。
 */
export function getReactWebviewHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  mode: string,
  extra?: Record<string, string>,
  title = "Atlas",
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
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; img-src ${webview.cspSource} data:; script-src 'nonce-${nonce}';">
  <link rel="stylesheet" href="${styleUri}">
  <title>${escapeHtml(title)}</title>
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
