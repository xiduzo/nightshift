/** Views: what people see of the runs, as the actor may see it. Each read of a run opens it first (`access`). `wireViews` binds the reads to their ports. */

export type { RunHere } from "./application/read-run-here";
export { type Views, wireViews } from "./wire";
