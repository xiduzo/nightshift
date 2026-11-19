/** Access: who may see or act on a run, or act in a Space. `openRun` is the one check of a request keyed by a run, `openSpace` the one of a request keyed by a Space or a project. `wireAccess` binds them to their ports. A door maps their refusals to its own words. */

export { SpaceNotFound } from "./domain/refusals";
export { type Access, wireAccess } from "./wire";
