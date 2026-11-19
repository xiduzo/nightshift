/** Actions: what a person does to a run (stop, resume, restart a step, run again from a node, send a Signal, release a lease, say it was useful, take it over), each a use case that opens the run for the actor first. `actOnRun` hands an action to the use case of its kind. `wireActions` binds them to their ports. */

export { type Actions, wireActions } from "./wire";
