import type { Caller } from "../contract";
import { forbidden, type HostExchangeDeps, STARTS_RUNS } from "./host-deps";
import type { HostExchange } from "./types";

/** The leases of the Spaces this Host keeps (`leases`), for the runs a Device walks. */
export function hostLeases(
	deps: Pick<HostExchangeDeps, "engine">,
): Pick<HostExchange, "leaseTake" | "leaseRenew" | "leaseRelease"> {
	const { engine } = deps;
	return {
		async leaseTake(caller, input) {
			await mayLease(caller, input.spaceId);
			return engine.leases.take({ ...input, walkerId: caller.deviceId });
		},

		async leaseRenew(caller, input) {
			await mayLease(caller, input.spaceId);
			return engine.leases.renew({ ...input, walkerId: caller.deviceId });
		},

		async leaseRelease(caller, input) {
			await mayLease(caller, input.spaceId);
			await engine.leases.release({ ...input, walkerId: caller.deviceId });
		},
	};

	/**
	 * Refuses a lease call for a Space another Host keeps (its leases are
	 * that Host's), and for a Person whose role there does not start runs.
	 */
	async function mayLease(caller: Caller, spaceId: string) {
		if ((await engine.hostSpaces.hostOf(spaceId)) !== null) {
			forbidden("Another computer keeps the leases of this Space.");
		}
		await caller.may(spaceId, STARTS_RUNS);
	}
}
