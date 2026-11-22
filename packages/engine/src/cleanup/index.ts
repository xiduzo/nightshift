/**
 * The cleanup of what runs leave on this computer: the scheduled sweep of
 * run worktrees and branches (and of the work it keeps of them), and the
 * files of run folders with their removal. `wireCleanup` binds the use
 * cases to their ports and starts the timer of the sweep.
 */

export type { RunFiles } from "./domain/run-files";
export { type Cleanup, wireCleanup } from "./wire";
