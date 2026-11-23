import type { EndDeviceWaits } from "./end-device-waits";
import type { EndQuietHours } from "./end-quiet-hours";
import type { PruneDeliveries } from "./prune-deliveries";
import type { SendHeldPushes } from "./send-held-pushes";

export type RunChecksPorts = {
	now(): number;
	/** `endDeviceWaits`, bound by the wire. */
	endWaits(request: EndDeviceWaits): Promise<void>;
	/** `sendHeldPushes`, bound by the wire. */
	sendHeld(request: SendHeldPushes): Promise<void>;
	/** `endQuietHours`, bound by the wire. */
	endQuiet(request: EndQuietHours): Promise<void>;
	/** `pruneDeliveries`, bound by the wire. */
	prune(request: PruneDeliveries): Promise<void>;
};

/**
 * What the timer checks, at one instant and in this order: the device
 * waits that ended, the held pushes that are due, the end of quiet hours,
 * and the prune of the log.
 */
export const runChecks = (ports: RunChecksPorts) => async (): Promise<void> => {
	const at = ports.now();
	await ports.endWaits({ at });
	await ports.sendHeld({ at });
	await ports.endQuiet({ at });
	await ports.prune({ at });
};
