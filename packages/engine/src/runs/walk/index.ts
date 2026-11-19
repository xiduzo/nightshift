/** The walk: a run's facts and its Turns, the Walkers of the runs walked elsewhere, and the start holds. Every use case that writes to a run shares them. `wireWalk` builds them. */

export type { RunFacts, Turns } from "./application/ports";
export type { StartHolds } from "./domain/start-holds";
export { wireWalk } from "./wire";
