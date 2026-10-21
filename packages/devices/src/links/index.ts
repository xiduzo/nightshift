/** This computer's Links to the Hosts it paired with: the links it keeps, the Spaces of those Hosts, pairing from the Device's side, and the procedures it calls on a Host. */

export type { HostClient } from "./host-client";
export {
	createHostLinks,
	type DeviceKeyStore,
	deviceKeyStore,
	type HostLinks,
	type HostRole,
} from "./host-links";
export {
	createHostSpaces,
	type HostSpaces,
	type ListedSpace,
	personOnHost,
} from "./host-spaces";
export { joinHost } from "./join";
export { createDeviceLinks, type DeviceLinks } from "./links";
export type {
	HostHello,
	JoinProgress,
	LinkedHost,
	PairingRedeemed,
	PairingStart,
} from "./types";
