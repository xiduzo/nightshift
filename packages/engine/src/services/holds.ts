import type { Device } from "../device";
import type { RunHolds } from "../graph";
import type { RunLog, ServiceHold } from "../log";
import type { ServiceKeeper } from "./keeper";

/**
 * The services of a run as the engine stops them (`RunHolds`):
 *
 * - On every end of the run they stop. An interrupted run keeps them for
 *   startup recovery: it continues the run, or tells `notContinuing`,
 *   and then they stop.
 * - A run that resumes stops what still runs of its services. It does not
 *   assume that the old process still lives.
 */
export function serviceHolds(deps: {
	keeper: Pick<ServiceKeeper, "stop">;
	log: Pick<RunLog, "state">;
	/** The Device a service runs on, as a step of its run reaches it. Null: it cannot be reached. */
	deviceOf(runId: string, deviceId: string): Promise<Device | null>;
}): RunHolds {
	/** The services the run held when it ended. */
	async function endedServices(runId: string): Promise<ServiceHold[]> {
		const state = await deps.log.state(runId);
		return state.endedHolding.filter(
			(hold): hold is ServiceHold => hold.kind === "service",
		);
	}
	async function stopAll(
		runId: string,
		services: readonly ServiceHold[],
	): Promise<void> {
		if (services.length === 0) return;
		const devices = await Promise.all(
			services.map((service) =>
				deps.deviceOf(runId, service.deviceId).catch(() => null),
			),
		);
		await deps.keeper.stop(
			runId,
			services.map((service, i) => ({
				service,
				device: devices[i] ?? null,
			})),
		);
	}
	return {
		async ended(runId, status) {
			if (status === "interrupted") return;
			await stopAll(runId, await endedServices(runId));
		},
		notContinuing: async (runId) => stopAll(runId, await endedServices(runId)),
		async resuming(row, run) {
			await stopAll(
				row.id,
				run.endedHolding.filter(
					(hold): hold is ServiceHold => hold.kind === "service",
				),
			);
		},
	};
}
