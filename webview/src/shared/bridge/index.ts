import type { Bridge } from "./types";
import { createVSCodeBridge } from "./vscode-bridge";

export const bridge: Bridge = createVSCodeBridge();

/**
 * Execute a bridge request with progress indicator.
 *
 * TODO: 阶段5 接入 panel-store 后恢复 operationInProgress 包装。
 * 参考项目原实现会通过 `usePanelStore.setState({ operationInProgress: true/false })`
 * 驱动进度动画（含 1s 最小显示时间），当前阶段 panel-store 尚未迁移，
 * 暂时退化为直接转发 bridge.request，保留同名导出以便后续组件直接调用。
 */
export async function bridgeWithProgress(
  command: string,
  params?: Record<string, unknown>,
): Promise<unknown> {
  return bridge.request(command, params);
}

export type {
  Bridge,
  EventMessage,
  RequestMessage,
  ResponseMessage,
} from "./types";
