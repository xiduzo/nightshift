/**
 * The devices domain of Night Shift: this computer among other Devices and
 * Hosts. It implements the engine's `Peers` port (`createPeerEngine`),
 * this computer as a Host, its Links to the Hosts it paired with, the
 * exchange of run history, Offers, and the work of runs placed on another
 * Device. The API serves it (`Devices`, `HostExchange`, `Offers`) and the
 * daemon wires it (`wireDevices`). The wire schemas of the peer protocol
 * are here too: the API checks each call with them.
 */

export { type ArchiveRef, archiveRefSchema } from "./archive";
export {
	type FollowWant,
	ForeignRowsError,
	feedStepSchema,
	followWantSchema,
	type HostExchange,
	type RunCommand,
	type RunRows,
	runRowsSchema,
	type SyncBatch,
	type SyncCursors,
	syncCursorsSchema,
	transcriptEntrySchema,
} from "./exchange";
export type {
	Devices,
	DevicesOverview,
	PairingReviewView,
} from "./host";
export type {
	DeviceLinks,
	HostClient,
	HostHello,
	HostRole,
	JoinProgress,
	ListedSpace,
	PairingRedeemed,
	PairingStart,
} from "./links";
export {
	deviceOffers,
	type OfferCaps,
	type Offers,
	type OfferView,
	offerCapsSchema,
	type SpaceDeviceView,
} from "./offers";
export { createPeerEngine, type PeerEngine } from "./peers";
export { listenHostname, ownCertificate, reachFor } from "./reach";
export type { PairedDevice } from "./registry";
export { createRelay, createWorkRelay } from "./relay";
export { type DeviceServices, wireDevices } from "./wire";
export {
	createWorkHub,
	type WorkDelivery,
	type WorkHub,
	type WorkReply,
	type WorkRequest,
	workReplySchema,
	workRequestSchema,
} from "./work";
