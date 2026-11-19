/** Recovery: what Night Shift does to a run on its own. Startup recovery and the resume of the runs it interrupted, the wakes of sleeping runs, a webhook's signal to a project's runs, and the stop of a run whose Offer ended. `wireRecovery` binds them to their ports. */

export { wireRecovery } from "./wire";
