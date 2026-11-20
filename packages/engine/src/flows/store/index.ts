/**
 * The flows, schedules, revisions and notices of each Project in its flow
 * document (`wireStore`), as Night Shift reads and changes them.
 *
 * `addNotices`, `flowSources`, `mark`, `marked`, `readSchedules`,
 * `saveFlow` and `saveSchedules` work on a flow document. They are here
 * for the import of a Clone's folder (`flows/import.ts`) only, until lane
 * F2 gives it ports of its own.
 */

export { flowSources } from "./adapters/out/yjs-flow-encoding";
export { saveFlow } from "./adapters/out/yjs-flow-saves";
export { addNotices, mark, marked } from "./adapters/out/yjs-notices";
export { readSchedules, saveSchedules } from "./adapters/out/yjs-schedules";
export {
	type FlowRevision,
	type RevisionKind,
	revisionKinds,
	same,
} from "./domain/flow-json";
export { flowNotFound } from "./domain/flow-save";
export type { FlowNotice, NoticeKind } from "./domain/notices";
export { type ProjectFlows, wireStore } from "./wire";
