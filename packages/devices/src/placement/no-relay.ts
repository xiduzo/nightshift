import type { WorkRelay } from "../contract";
import { NO_STARTER } from "../offers";

/** The work relays of a step that no Device can take: each call answers with why. */

/** A work relay that reaches nobody. */
export const UNREACHABLE: WorkRelay = {
	async *call() {
		yield {
			kind: "error",
			message: "This computer cannot reach the device this step is placed on.",
			offline: true,
		};
	},
	online: () => false,
};

/** A run with no starter: nothing is sent, and every call is refused here. */
export const NO_STARTER_RELAY: WorkRelay = {
	async *call() {
		yield { kind: "error", message: NO_STARTER };
	},
	online: () => true,
};
