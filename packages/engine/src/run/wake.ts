import type { Database } from "@nightshift/db";
import type { Runner } from "../graph";
import { type RunLog, runIdsWalkedBy } from "../log";
import { deriveSleep } from "../read";

/**
 * A Device is back: the steps of the runs this computer walks that sleep
 * because a Device was offline look again now. One whose Device is still
 * away sleeps again.
 */
export async function wakeOfflineSleeps(deps: {
	db: Database;
	log: Pick<RunLog, "walkerId" | "derive">;
	runner: Pick<Runner, "take">;
}): Promise<void> {
	const self = await deps.log.walkerId();
	const sleeping = await deps.log.derive(
		await runIdsWalkedBy(deps.db, self),
		deriveSleep,
	);
	for (const [runId, sleep] of sleeping) {
		if (sleep?.reason !== "device-offline") continue;
		deps.runner.take(runId, { kind: "wake", early: true }).catch(() => {});
	}
}
