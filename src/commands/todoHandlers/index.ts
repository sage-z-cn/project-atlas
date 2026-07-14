import type { TodoHandlerContext } from "./todoHandlers";
import { registerTodoHandlers } from "./todoHandlers";

export function registerTodoHandlersAll(ctx: TodoHandlerContext): void {
  registerTodoHandlers(ctx);
}

export type {
  TodoHandlerContext,
  TodoItemDto,
  TodosDataDto,
} from "./todoHandlers";
export { TODO_EVENTS } from "./todoHandlers";
