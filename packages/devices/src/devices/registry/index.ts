/** The Devices: this computer's own Device row, and on a Host the Devices that paired with it, their presence and its audit. */

export type { DevicePresence, PairedDevice } from "./domain/paired-device";
export {
	type DeviceRegistry,
	wireRegistry,
} from "./wire";
