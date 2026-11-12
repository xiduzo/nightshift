/** The Devices: this computer's own Device row, and on a Host the Devices that paired with it, their presence and its audit. */

export { machineFingerprint } from "./machine";
export {
	createDeviceRegistry,
	type DevicePresence,
	type DeviceRegistry,
	deviceNamesOf,
	homePersonsOf,
	knownDevices,
	OFFLINE_AFTER_MS,
	type PairedDevice,
} from "./registry";
export {
	adoptSelfDevice,
	defaultSelfDeviceHost,
	inContainer,
	selfDevice,
	selfOwnerId,
	setSelfOwner,
} from "./self-device";
