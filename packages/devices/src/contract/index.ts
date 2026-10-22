/**
 * The peer protocol of `@nightshift/devices`: the wire schemas and types a
 * Device and its Host exchange, the Host's procedures as a Device calls
 * them (`HostClient`), and what this Device asks of its Hosts
 * (`HostRelay`). It imports no other vertical, so every vertical may name
 * these types without a cycle.
 */

export { type ArchiveRef, archiveRefSchema, copyStampSchema } from "./archive";
export type { HostClient } from "./host-client";
export type {
	HostHello,
	ListedSpace,
	PairingRedeemed,
	PairingStart,
} from "./links";
export { type OfferCaps, offerCapsSchema } from "./offers";
export type { HostRelay } from "./relay";
export {
	type RunRows,
	runRowsSchema,
	type SyncCursors,
	syncCursorsSchema,
} from "./rows";
export {
	type FollowWant,
	feedStepSchema,
	followWantSchema,
	type RunCommand,
	type SyncBatch,
	transcriptEntrySchema,
} from "./sync";
export {
	type WorkCall,
	type WorkDelivery,
	type WorkFor,
	type WorkRelay,
	type WorkReply,
	type WorkRequest,
	workReplySchema,
	workRequestSchema,
} from "./work";
