import type {
  Bridge,
  EventMessage,
  RequestMessage,
  ResponseMessage,
} from "./types";
import { t } from "../i18n-core";

declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

export function createVSCodeBridge(): Bridge {
  const vscode = acquireVsCodeApi();
  const pendingRequests = new Map<
    string,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  const eventHandlers = new Set<(event: string, data: unknown) => void>();

  window.addEventListener("message", (e: MessageEvent) => {
    const msg = e.data;
    if (msg.type === "response") {
      const resp = msg as ResponseMessage;
      const pending = pendingRequests.get(resp.id);
      if (pending) {
        pendingRequests.delete(resp.id);
        if (resp.success) {
          pending.resolve(resp.data);
        } else {
          pending.reject(new Error(resp.error?.message ?? "Unknown error"));
        }
      }
    } else if (msg.type === "event") {
      const evt = msg as EventMessage;
      for (const h of eventHandlers) {
        h(evt.event, evt.data);
      }
    }
  });

  return {
    request(command, params = {}, options?: { timeout?: number }) {
      return new Promise((resolve, reject) => {
        const id = crypto.randomUUID();
        const timeout = setTimeout(() => {
          pendingRequests.delete(id);
          // name 是 locale 无关的稳定标记，供调用方区分超时（翻译后的
          // message 不再含 "timed out"，不能靠正则匹配文本）。
          const err = new Error(t("Request '{0}' timed out", command));
          err.name = "BridgeTimeout";
          reject(err);
        }, options?.timeout ?? 10_000);

        pendingRequests.set(id, {
          resolve: (v) => {
            clearTimeout(timeout);
            resolve(v);
          },
          reject: (e) => {
            clearTimeout(timeout);
            reject(e);
          },
        });

        const msg: RequestMessage = { type: "request", id, command, params };
        vscode.postMessage(msg);
      });
    },
    onEvent(handler) {
      eventHandlers.add(handler);
      return () => {
        eventHandlers.delete(handler);
      };
    },
    getState: () => vscode.getState(),
    setState: (state: unknown) => vscode.setState(state),
  };
}
