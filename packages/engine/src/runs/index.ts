/** Runs: who may see or act on a run (`access`), and what every use case that writes to a run shares (`walk`). Each sub-vertical has its own rings and its `wire.ts`. From outside `runs/`, this barrel is the only door. */

export { type Access, wireAccess } from "./access";
export { type StartHolds, wireWalk } from "./walk";
