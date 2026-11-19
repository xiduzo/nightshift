/** The run path before its slices (`runs/`, `gates/`): the answer to a Gate and the move of a run (which `runs/actions` takes), the other end of a move, and what the schedules tell. The composition (`wire.ts` and the `wire-*.ts` files beside it) makes each piece. */

export { createAnswerPath, GateClosedError } from "./answer";
export { createMovePath, type MovePath } from "./move";
export { createScheduleNotices } from "./schedule-notices";
export { takeOver } from "./take-over";
