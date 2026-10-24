/**
 * The devices domain of Night Shift: this computer among other Devices and
 * Hosts. It implements the engine's `Peers` port (`createPeerEngine`),
 * this computer as a Host, its Links to the Hosts it paired with, the
 * exchange of run history, Offers, and the work of runs placed on another
 * Device. The API serves it (`Devices`, `HostExchange`, `Offers`) and the
 * daemon wires it (`wireDevices`). The wire schemas of the peer protocol
 * are here too: the API checks each call with them.
 */

export {
	type ArchiveRef,
	archiveRefSchema,
	copyStampSchema,
	type FollowWant,
	feedStepSchema,
	followWantSchema,
	type HostClient,
	type HostHello,
	type ListedSpace,
	type OfferCaps,
	offerCapsSchema,
	type PairingRedeemed,
	type PairingStart,
	type PhoneView,
	type RunCommand,
	type RunRows,
	runRowsSchema,
	type SyncBatch,
	type SyncCursors,
	syncCursorsSchema,
	transcriptEntrySchema,
	type WorkDelivery,
	type WorkReply,
	type WorkRequest,
	workReplySchema,
	workRequestSchema,
} from "./contract";
export type { HostExchange } from "./exchange";
export type {
	Devices,
	DevicesOverview,
	PairingReviewView,
} from "./host";
export type { DeviceLinks, HostRole, JoinProgress } from "./links";
export {
	deviceOffers,
	type Offers,
	type OfferView,
	type SpaceDeviceView,
} from "./offers";
export {
	createPeerEngine,
	deviceDirectory,
	type PeerEngine,
} from "./peers";
export { listenHostname, ownCertificate, reachFor } from "./reach";
export {
	type PairedDevice,
	selfDevice,
	selfOwnerId,
	setSelfOwner,
} from "./registry";
export { createRelay, createWorkRelay } from "./relay";
export { type DeviceServices, wireDevices } from "./wire";
export { createWorkHub, type WorkHub } from "./work";
