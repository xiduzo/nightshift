/** Setup: what a project folder needs before runs can start in it, and the fixes a person asks for. `wireSetup` binds the use cases to their ports. */

export type { ProjectReadiness } from "./domain/readiness";
export { type Setup, wireSetup } from "./wire";
