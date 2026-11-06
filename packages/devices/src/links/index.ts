/** This computer's Links to the Hosts it paired with: the links it keeps, the Spaces of those Hosts, pairing from the Device's side, the procedures it calls on a Host, and the Clones it tells each Host of. */

export { backoff, pause } from "./backoff";
export { tellClones } from "./clones";
export type { OpenDocumentChannel, SyncedDocument } from "./document-channel";
export { type CallOptions, NotPairedError } from "./from-host";
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
export { type JoinDeps, joinHost } from "./join";
export type { Link } from "./link";
export {
	createDeviceLinks,
	type DeviceLinks,
	type LinkOptions,
} from "./links";
export type { JoinProgress, LinkedHost } from "./types";
