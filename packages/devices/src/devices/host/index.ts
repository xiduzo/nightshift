/** This computer as a Host: pairing, Device keys, presence, the Devices page, and the procedures its paired Devices call. */

export { createDevices } from "./adapters/in/devices-page";
export {
	type HostPeerContext,
	type HostPhones,
	hostRouter,
} from "./adapters/in/host-router";
export type {
	Devices,
	DevicesOverview,
	OtherDeviceView,
	PairingReviewView,
} from "./adapters/in/page-types";
export {
	type ServedDocuments,
	servedDocuments,
} from "./adapters/in/served-documents";
export type { PendingPairings } from "./domain/pending";
export { type Host, wireHost } from "./wire";
