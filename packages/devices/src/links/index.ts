/** This computer's Links to the Hosts it paired with: the links it keeps, the Spaces of those Hosts, pairing from the Device's side, and the procedures it calls on a Host. */

export { backoff, pause } from "./backoff";
export type { OpenDocumentChannel, SyncedDocument } from "./document-channel";
export { fromHost } from "./from-host";
export {
	createHostLinks,
	type DeviceKeyStore,
	deviceKeyStore,
	type HostLink,
	type HostLinks,
	type HostRole,
} from "./host-links";
export {
	createHostSpaces,
	type HostSpaceRef,
	type HostSpaces,
	keptByHomeHost,
	personInSpace,
	personOnHost,
} from "./host-spaces";
export { joinHost } from "./join";
export type { Link } from "./link";
export {
	createDeviceLinks,
	type DeviceLinks,
	type LinkOptions,
} from "./links";
export type { JoinProgress, LinkedHost } from "./types";
