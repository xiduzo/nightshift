/**
 * The peer protocol of `@nightshift/devices`: the Host's procedures as one
 * oRPC contract (`hostContract`, its client `HostClient`), the wire schemas
 * and types a Device and its Host exchange, and what this Device asks of
 * its Hosts (`HostRelay`). It imports no other vertical, so every vertical
 * may name these types without a cycle.
 */

export type { ArchiveRef } from "./archive";
export {
	type HostClient,
	type HostProcedureMeta,
	hostContract,
	NOT_A_HOST,
	refusalDataSchema,
} from "./host-contract";
export {
	type HostHello,
	type ListedSpace,
	type PairingRedeemed,
	type PairingStart,
	type PhoneView,
	phoneSchema,
} from "./links";
export { type OfferCaps, offerCapsSchema, offerRefSchema } from "./offers";
export type {
	ElsewhereProject,
	PersonalMerge,
	PersonalMergeInput,
} from "./personal";
export { READS, READS_HEADER, reads } from "./reads";
export type { HostRelay } from "./relay";
export type { RunRows, SyncCursors } from "./rows";
export type {
	CommandBatch,
	FollowWant,
	RunCommand,
	SyncBatch,
} from "./sync";
export {
	type WorkCall,
	type WorkDelivery,
	type WorkFor,
	type WorkRelay,
	type WorkReply,
	type WorkRequest,
	workRequestSchema,
} from "./work";
