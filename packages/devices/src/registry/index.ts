/** The Devices: this computer's own Device row, and on a Host the Devices that paired with it, their presence and its audit. */

export {
	createDeviceRegistry,
	type DevicePresence,
	type DeviceRegistry,
	deviceNamesOf,
	homePersonsOf,
	OFFLINE_AFTER_MS,
	type PairedDevice,
} from "./registry";
export {
	selfDevice,
	selfOwnerId,
	setSelfOwner,
} from "./self-device";
