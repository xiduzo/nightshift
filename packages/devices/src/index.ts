/**
 * The devices domain of Night Shift: this computer among other Devices and
 * Hosts. It implements the engine's `Peers` port (`createPeerEngine`),
 * this computer as a Host, its Links to the Hosts it paired with, the
 * exchange of run history, Offers, and the work of runs placed on another
 * Device. The API serves it (`Devices`, `HostExchange`, `Offers`). The
 * daemon starts it with one call (`startDevices`): the engine and every
 * devices piece, handed over on a `bun --hot` reload. The peer protocol
 * is here too: the Host's procedures as one oRPC contract
 * (`hostContract`), implemented once (`hostRouter`), which the API mounts
 * at its paths.
 */

export {
	type ArchiveRef,
	type FollowWant,
	type HostClient,
	type HostHello,
	type HostProcedureMeta,
	hostContract,
	type ListedSpace,
	type MergePreview,
	type MergeResult,
	type OfferCaps,
	offerCapsSchema,
	offerRefSchema,
	type PairingRedeemed,
	type PairingStart,
	type PhoneView,
	phoneSchema,
	READS,
	READS_HEADER,
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
	type OtherDeviceView,
	type PairingReviewView,
} from "./host";
export type { HostRole, JoinProgress } from "./links";
export type { Offers, OfferView, SpaceDeviceView } from "./offers";
export { deviceDirectory, type PeerEngine } from "./peers";
export {
	type PairedDevice,
	selfDevice,
	selfOwnerId,
	setSelfOwner,
} from "./registry";
export { type DevicesRuntime, type KeptDevices, startDevices } from "./wire";
