/** Access: who may see or act on a run, or act in a Space. `openRun` is the one check of a request keyed by a run, `openSpace` the one of a request keyed by a Space or a project, `openComputer` the one of a request about this computer. `wireAccess` and `wireComputer` bind them to their ports. A door maps their refusals to its own words. */

export { type ComputerAccess, wireComputer } from "./computer";
export { RunNotFound, SpaceNotFound } from "./domain/refusals";
export { type Access, wireAccess } from "./wire";
