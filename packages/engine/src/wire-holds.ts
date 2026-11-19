import type { Database } from "@nightshift/db";
import type { DeviceDirectory, LeaseHost } from "./contract";
import { combineHolds } from "./graph";
import {
	createLeaseKeeper,
	createLeaseStore,
	leaseHolds,
	leasesLost,
} from "./leases";
import { getRunRow, type RunLog } from "./log";
import type { createPlacement } from "./placement";
import { createServiceKeeper, serviceHolds } from "./services";

/**
 * The leases, services and holds block of the engine's composition
 * (`wire.ts`): the leases of the Spaces this Replica keeps and of the
 * runs it walks (`leases/`, ADR 7), the services of the runs this
 * computer walks (`services/`, ADR 9), and what runs hold for a scope.
 * The lease keeper starts at once, with the engine's lifetime.
 *
 * It gives `leaseStore`, `leases`, `services` and `runHolds`.
 */
export function wireEngineHolds(deps: {
	db: Database;
	log: RunLog;
	now(): number;
	minuteMs: number;
	/** How long one second of a service lasts (`EngineInternals.secondMs`). */
	secondMs: number | undefined;
	directory: Pick<DeviceDirectory, "hostedElsewhere">;
	/** The leases of the Spaces a Host keeps, when this computer has a relay. */
	relay: LeaseHost | undefined;
	placement: Pick<ReturnType<typeof createPlacement>, "deviceById">;
	/** A lease of this Replica's store went: the runs here that wait for a lease ask again. */
	onFreed(): void;
	/** The engine's lifetime. */
	signal: AbortSignal;
}) {
	const { db, log: runLog, now, directory, placement } = deps;
	const leaseStore = createLeaseStore({ db, now });
	const leases = createLeaseKeeper({
		db,
		store: leaseStore,
		hostedElsewhere: (spaceId) => directory.hostedElsewhere(spaceId),
		...(deps.relay ? { relay: deps.relay } : {}),
		walkerId: () => runLog.walkerId(),
		minuteMs: deps.minuteMs,
		onFreed: () => deps.onFreed(),
		onLost: (runId, names) => leasesLost({ log: runLog }, runId, names),
	});
	leases.start(deps.signal);
	const services = createServiceKeeper({
		now,
		...(deps.secondMs !== undefined ? { secondMs: deps.secondMs } : {}),
	});
	/** What runs hold for a scope: the engine lets go of it when a run ends. */
	const runHolds = combineHolds([
		leaseHolds({ keeper: leases, log: runLog }),
		serviceHolds({
			keeper: services,
			log: runLog,
			deviceOf: async (runId, deviceId) =>
				placement.deviceById(deviceId, await getRunRow(db, runId)),
		}),
	]);
	return { leaseStore, leases, services, runHolds };
}
