import * as vscode from "vscode";

/**
 * Extension-wide diagnostic logger backed by one shared "Project Atlas"
 * output channel.
 *
 * Why a single channel: every diagnostic in the extension (badge decisions,
 * git flow traces, future instrumentation) writes here so users have one
 * predictable place to look, instead of one channel per subsystem.
 *
 * The channel is created lazily on first use — simply importing the module
 * costs nothing. It then lives for the whole extension lifetime and is NOT
 * disposed explicitly: VSCode reclaims output channels on extension unload,
 * which is the prevailing convention (disposing a shared singleton channel
 * would break any other caller still holding a reference).
 *
 * Webview (browser) code runs in an isolated context without access to the
 * VS Code API and therefore cannot write here — it must keep using the
 * browser devtools console.
 */
const CHANNEL_NAME = "Project Atlas";

let channel: vscode.OutputChannel | null = null;

function getChannel(): vscode.OutputChannel {
  if (!channel) {
    channel = vscode.window.createOutputChannel(CHANNEL_NAME);
  }
  return channel;
}

const pad = (n: number, len = 2): string => String(n).padStart(len, "0");
const stamp = (): string => {
  // Local time, HH:MM:SS.mmm. toISOString() is UTC and shifts the timestamp.
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
};

export const logger = {
  /** Append one timestamped line. */
  log(msg: string): void {
    getChannel().appendLine(`[${stamp()}] ${msg}`);
  },
  /** Append one timestamped INFO line. */
  info(msg: string): void {
    getChannel().appendLine(`[${stamp()}] INFO  ${msg}`);
  },
  /** Append one timestamped WARN line. */
  warn(msg: string): void {
    getChannel().appendLine(`[${stamp()}] WARN  ${msg}`);
  },
  /** Append one timestamped ERROR line. */
  error(msg: string): void {
    getChannel().appendLine(`[${stamp()}] ERROR ${msg}`);
  },
  /** Emit a titled section divider (blank line + heading). */
  section(title: string): void {
    const ch = getChannel();
    ch.appendLine("");
    ch.appendLine(`──── ${title} ────`);
  },
  /** Reveal the channel panel in the Output view. */
  show(preserveFocus = true): void {
    getChannel().show(preserveFocus);
  },
};
