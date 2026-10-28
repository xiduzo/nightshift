/** This computer as a Host: pairing, Device keys, presence, the Devices page, and the procedures its paired Devices call. */

export { createDevices } from "./devices";
export { createHost, type Host, type PendingPairings } from "./host";
export { type HostPeerContext, type HostPhones, hostRouter } from "./router";
export type {
	Devices,
	DevicesOverview,
	OtherDeviceView,
	PairingReviewView,
} from "./types";
