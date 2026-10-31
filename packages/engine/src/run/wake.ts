import type { Database } from "@nightshift/db";
import type { Runner } from "../graph";
import { type RunLog, runIdsWalkedBy, type WaitReason } from "../log";
import { deriveSleep } from "../read";

type WakeDeps = {
	db: Database;
	log: Pick<RunLog, "walkerId" | "derive">;
	runner: Pick<Runner, "take">;
};

/** Wakes the steps of the runs this computer walks that sleep for `reason`. */
async function wakeSleepsFor(
	deps: WakeDeps,
	reason: WaitReason,
): Promise<void> {
	const self = await deps.log.walkerId();
	const sleeping = await deps.log.derive(
		await runIdsWalkedBy(deps.db, self),
		deriveSleep,
	);
	for (const [runId, sleep] of sleeping) {
		if (sleep?.reason !== reason) continue;
		deps.runner.take(runId, { kind: "wake", early: true }).catch(() => {});
	}
}

/**
 * A Device is back: the steps of the runs this computer walks that sleep
 * because a Device was offline look again now. One whose Device is still
 * away sleeps again.
 */
export function wakeOfflineSleeps(deps: WakeDeps): Promise<void> {
	return wakeSleepsFor(deps, "device-offline");
}

/**
 * A lease of this computer's store went: the Lease steps of the runs this
 * computer walks that wait for a lease ask again now. One whose lease is
 * still busy sleeps again.
 */
export function wakeLeaseSleeps(deps: WakeDeps): Promise<void> {
	return wakeSleepsFor(deps, "lease");
}
