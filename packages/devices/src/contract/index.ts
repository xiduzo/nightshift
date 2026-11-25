/**
 * The peer protocol of `@nightshift/devices`: the Host's procedures as one
 * oRPC contract (`hostContract`, its client `HostClient`), the wire schemas
 * and types a Device and its Host exchange, and what this Device asks of
 * its Hosts (`HostRelay`). It imports no other vertical, so every vertical
 * may name these types without a cycle.
 */

export type { ArchiveRef, KnowledgeRef } from "./archive";
export type { Caller } from "./caller";
export { type HostClient, hostContract } from "./host-contract";
export {
	type HostHello,
	hostHelloSchema,
	type ListedSpace,
	type PairingRedeemed,
	type PairingStart,
	type PhoneView,
	phoneSchema,
} from "./links";
export { type OfferCaps, offerCapsSchema, offerRefSchema } from "./offers";
export type {
	ElsewhereProject,
	LeaveResult,
	MergePending,
	MergePreview,
	MergeProjectView,
	MergeResult,
	MergeState,
	PersonalMerge,
	PersonalMergeInput,
	SplitResult,
	SplitState,
} from "./personal";
export { OFFLINE_AFTER_MS } from "./presence";
export {
	type HostProcedureMeta,
	NOT_A_HOST,
	refusalDataSchema,
} from "./procedure";
export type { HostRelay, InStep } from "./relay";
export type {
	PersonalSecretName,
	ProjectSecretName,
	SecretMove,
} from "./secrets";
export {
	ANSWER_COSTS_MAX,
	type AnswerCostsBatch,
	type CommandBatch,
	type FollowWant,
	type PendingBatch,
	type PendingElsewhere,
	type RunCommand,
	type RunRows,
	type SyncBatch,
	type SyncCursors,
} from "./sync";
export {
	deviceVersionOf,
	documentToken,
	helloSaidBy,
	hostVersionOf,
	keyOfDocumentToken,
	VERSION_HEADER,
} from "./version";
export {
	secretRequestSchema,
	UNREADABLE_REQUEST,
	type WorkCall,
	type WorkDelivery,
	type WorkFor,
	type WorkRelay,
	type WorkReply,
	type WorkRequest,
	workRequestSchema,
} from "./work";
