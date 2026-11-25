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
	pairingRedeemedSchema,
	pairingStartSchema,
	phoneSchema,
} from "./links";
export { type OfferCaps, offerCapsSchema, offerRefSchema } from "./offers";
export {
	type ElsewhereProject,
	type LeaveResult,
	type MergePending,
	type MergePreview,
	type MergeProjectView,
	type MergeResult,
	type MergeState,
	type PersonalMerge,
	type PersonalMergeInput,
	personalMergeSchema,
	type SplitResult,
	type SplitState,
} from "./personal";
export { OFFLINE_AFTER_MS } from "./presence";
export {
	type HostProcedureMeta,
	hostAnswer,
	keyRefusalSchema,
	NOT_A_HOST,
	ODD_HOST_ANSWER,
	refusalDataSchema,
} from "./procedure";
export type { HostRelay, InStep } from "./relay";
export {
	type PersonalSecretName,
	type ProjectSecretName,
	type SecretMove,
	takenSecretSchema,
} from "./secrets";
export {
	ANSWER_COSTS_MAX,
	type AnswerCostsBatch,
	addedProjectSchema,
	answerCostsBatchSchema,
	type CommandBatch,
	type FollowWant,
	type PendingBatch,
	type PendingElsewhere,
	type RunCommand,
	type RunRows,
	type SyncBatch,
	type SyncCursors,
	syncBatchSchema,
} from "./sync";
export {
	askedHostOf,
	deviceVersionOf,
	documentToken,
	HOST_HEADER,
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
