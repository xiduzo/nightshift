/**
 * The flows, schedules, revisions and notices of each Project in its flow
 * document (`wireStore`), as Night Shift reads and changes them.
 */

export { type RevisionKind, revisionKinds } from "./domain/flow-json";
export type { FlowMergePlan } from "./domain/flow-merge";
export { flowNotFound } from "./domain/flow-save";
export type { FlowNotice } from "./domain/notices";
export {
	type FlowImports,
	type FlowMerges,
	type ProjectFlows,
	wireStore,
} from "./wire";
