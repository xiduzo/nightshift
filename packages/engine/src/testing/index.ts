/**
 * Test helpers of `@nightshift/engine`: a migrated database in a temporary
 * folder, a test device, the peers and the Device rows of a computer that is
 * alone, a run log and bus to write events into, and a project's flows
 * (`seedFlows`). Also the engine's own stores and readers that
 * only tests build or read directly: production code reaches them through the
 * `Engine`, `wireSettings` and the daemon's run files. Only tests
 * import this entry.
 */

export { spaceDocumentName } from "../documents/space/space-document";
export { wireStore as createProjectFlows } from "../flows/store/wire";
export { createRunHistory } from "../log/history/history";
export { parseEventRow } from "../log/run-log/append";
export { createRunLog, type RunLog } from "../log/run-log/run-log";
export { placedRun } from "../log/run-row/run-row";
export { createRunBus, type RunBus } from "../log/transcript/bus";
export type { LandedChange } from "../read/landed-facts";

export { answerCostsOn } from "./answer-costs";
export {
	createCliToolStore,
	createConnectionStore,
	createProfileStore,
	createSettingsStore,
	openConfigStores,
} from "./config-stores";
export { dashboardOver } from "./dashboard";
export { deviceRowsOn, placesOn } from "./device-rows";
export { testInbox } from "./gates";
export { joinSpace } from "./join-space";
export { testKnowledge } from "./knowledge";
export { openRunBundle } from "./run-bundle";
export { runEvents } from "./run-events";
export { seedFlows } from "./seed-flows";
export {
	connectionsOf,
	createSandbox,
	expectRunLogsInSync,
	harnessesOf,
	mustGit,
	type Sandbox,
	sleepClock,
	type TestEngineOptions,
	testDevice,
	waitFor,
	withDevice,
} from "./test-support";
