import type { TaskHandlerContext } from "./taskHandlers";
import { registerTaskHandlers } from "./taskHandlers";

export function registerTaskHandlersAll(ctx: TaskHandlerContext): void {
  registerTaskHandlers(ctx);
}

export type {
  TaskHandlerContext,
  TaskItemDto,
  TaskProjectDto,
  TasksDataDto,
} from "./taskHandlers";
export { TASK_EVENTS } from "./taskHandlers";
