import type { Database } from "@nightshift/db";
import { event, run } from "@nightshift/db/schema";
import type { JsonValue } from "@nightshift/flows";
import { and, eq, sql } from "drizzle-orm";
import type { Runner } from "../graph";
import type { LoggedEvent, RunLog } from "../log";
import { deriveSleep, type SleepFact } from "../read";
import { RunRefusal } from "../run-status";

/**
 * Signals from webhooks: a webhook schedule sends a signal to every run of
 * its project that waits for it, not to one run by its id (that is
 * `actions.ts`). A run wakes when it sleeps in a Wait on the signal's
 * name, and the Wait's key (rendered when the wait began) is absent or
 * equals the signal's. The webhook's event is the Wait's data.
 *
 * Only the runs this computer walks wake: a run another Device walks
 * waits for a signal sent there, or by its id.
 */

export type SignalsDeps = {
	db: Database;
	log: RunLog;
	runner: Pick<Runner, "take">;
};

export type Signals = ReturnType<typeof createSignals>;

/** A webhook's signal: its name, its key (null: none) and the event. */
export type ProjectSignal = {
	name: string;
	key: string | null;
	data: JsonValue;
};

/** Whether the sleep waits for this signal: the name, and its key when it has one. */
function waitsFor(sleep: SleepFact | null, signal: ProjectSignal): boolean {
	return (
		sleep?.signal === signal.name &&
		(sleep.signalKey === null || sleep.signalKey === signal.key)
	);
}

export function createSignals(deps: SignalsDeps) {
	const { db, log, runner } = deps;

	/**
	 * The runs of the project this computer walks that ever waited for a
	 * signal of that name. Most have moved on; the log of each says.
	 */
	async function candidates(projectId: string, name: string) {
		const walkerId = await log.walkerId();
		const rows = await db
			.selectDistinct({ runId: event.runId })
			.from(event)
			.innerJoin(run, eq(run.id, event.runId))
			.where(
				and(
					eq(event.type, "WaitStarted"),
					eq(run.projectId, projectId),
					eq(run.walkerId, walkerId),
					sql`json_extract(${event.payload}, '$.signal') = ${name}`,
				),
			);
		return rows.flatMap((row) => (row.runId ? [row.runId] : []));
	}

	return {
		/**
		 * Wakes every run of the project that waits for the signal, each in a
		 * Turn of its own: a full run cap queues the wake. Returns how many
		 * runs it woke or queued.
		 */
		async send(projectId: string, signal: ProjectSignal): Promise<number> {
			let woke = 0;
			for (const runId of await candidates(projectId, signal.name)) {
				if (!waitsFor(deriveSleep(await log.events(runId)), signal)) continue;
				try {
					await runner.take(
						runId,
						{
							kind: "wake",
							early: true,
							signal: signal.name,
							data: signal.data,
						},
						{
							whenFull: "queue",
							// It may have moved on since: a stop, a person's signal.
							check: (events: readonly LoggedEvent[]) => {
								if (!waitsFor(deriveSleep(events), signal)) {
									throw new RunRefusal(
										"wrong-signal",
										"This run does not wait for that signal.",
									);
								}
							},
						},
					);
					woke++;
				} catch (error) {
					if (!(error instanceof RunRefusal)) {
						console.error(`[signals] could not wake run ${runId}`, error);
					}
				}
			}
			return woke;
		},
	};
}
