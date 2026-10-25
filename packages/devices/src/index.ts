/**
 * The devices domain of Night Shift: this computer among other Devices and
 * Hosts. It implements the engine's `Peers` port (`createPeerEngine`),
 * this computer as a Host, its Links to the Hosts it paired with, the
 * exchange of run history, Offers, and the work of runs placed on another
 * Device. The API serves it (`Devices`, `HostExchange`, `Offers`) and the
 * daemon wires it (`wireDevices`). The peer protocol is here too: the
 * Host's procedures as one oRPC contract (`hostContract`), implemented
 * once (`hostRouter`), which the API mounts at its paths.
 */

export {
	type ArchiveRef,
	type FollowWant,
	type HostClient,
	type HostHello,
	type HostProcedureMeta,
	hostContract,
	type ListedSpace,
	type OfferCaps,
	offerCapsSchema,
	offerRefSchema,
	type PairingRedeemed,
	type PairingStart,
	type PhoneView,
	phoneSchema,
	type RunCommand,
	type RunRows,
	type SyncBatch,
	type SyncCursors,
	type WorkDelivery,
	type WorkReply,
	type WorkRequest,
} from "./contract";
export type { HostExchange } from "./exchange";
export {
	type Devices,
	type DevicesOverview,
	type HostPeerContext,
	type HostPhones,
	hostRouter,
	type PairingReviewView,
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
