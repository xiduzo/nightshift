import type { Database } from "@nightshift/db";
import type { Actor } from "../contract";
import type { Runner } from "../graph";
import { type RunLog, type RunRow, runIdsWalkedBy } from "../log";
import { deriveSleep } from "../read";
import type { RunRelay } from "./relay";

/**
 * Wakes a sleeping run early. A signal wakes a run whose Wait node waits
 * for it; on a run another Device walks, it travels to the Walker as a
 * command.
 */
export async function signalRun(
	deps: {
		log: Pick<RunLog, "events">;
		runner: Pick<Runner, "take">;
		relay: RunRelay;
	},
	row: RunRow,
	actor: Actor | undefined,
	name: string,
): Promise<void> {
	const sleep = deriveSleep(await deps.log.events(row.id));
	if (!sleep || sleep.signal !== name) {
		throw new Error("This run does not wait for that signal.");
	}
	if (await deps.relay.walkedElsewhere(row)) {
		await deps.relay.send(row, actor, {
			kind: "signal.send",
			payload: { name },
		});
		return;
	}
	// The thread continues at once, like a wake a person asks for: a
	// full run cap fails here rather than queueing the signal.
	await deps.runner.take(row.id, { kind: "wake", early: true, signal: name });
}

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
