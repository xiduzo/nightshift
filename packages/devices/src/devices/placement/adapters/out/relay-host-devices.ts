import { HostUnreachableError } from "@nightshift/engine";
import { Refusal } from "@nightshift/refusal";
import type { HostRelay } from "../../../../contract";
import type { HostDevices } from "../../application/ports";

/** The Devices a Host lists, over this computer's Links. Null: it has none. */
export function relayHostDevices(
	relay: Pick<HostRelay, "devices"> | null,
): HostDevices {
	return {
		async list(project) {
			if (!relay) return [];
			try {
				return await relay.devices(project);
			} catch (error) {
				// A refusal of the Host stands. A link that dropped, a fetch
				// that failed: the Host cannot be reached now.
				if (
					error instanceof Refusal &&
					!(error instanceof HostUnreachableError)
				) {
					throw error;
				}
				return null;
			}
		},
	};
}
