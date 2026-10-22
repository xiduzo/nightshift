/** The Devices: this computer's own Device row, and on a Host the Devices that paired with it, their presence and its audit. */

export {
	createDeviceRegistry,
	type DeviceRegistry,
	deviceNamesOf,
	OFFLINE_AFTER_MS,
	type PairedDevice,
} from "./registry";
export {
	selfDevice,
	selfDeviceId,
	selfOwnerId,
	setSelfOwner,
} from "./self-device";
