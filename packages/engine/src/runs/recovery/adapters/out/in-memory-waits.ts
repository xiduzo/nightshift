import { foldRun, type LoggedEvent } from "../../../../log";
import type { Waits } from "../../application/ports";

/** The Walker the in-memory runs name when a test gives none: this computer. */
const THIS_COMPUTER = "this-computer";

/** A run as the twin holds it: its project, its Walker and its log. */
type TwinRun = { projectId: string; walkerId: string; events: LoggedEvent[] };

/**
 * The sleeps of runs, in memory. A test adds a run with its project and
 * its log (`add`). A run's sleep is the fold of its log, as the run log
 * folds it.
 */
export function inMemoryWaits(walkerId = THIS_COMPUTER) {
	const runs = new Map<string, TwinRun>();
	const here = () => [...runs].filter(([, run]) => run.walkerId === walkerId);
	const twin = {
		/** Puts a run in the twin. By default this computer walks it. */
		add(
			runId: string,
			run: {
				projectId: string;
				walkerId?: string;
				events: readonly LoggedEvent[];
			},
		) {
			runs.set(runId, {
				projectId: run.projectId,
				walkerId: run.walkerId ?? walkerId,
				events: [...run.events],
			});
		},
		async sleeping() {
			return new Map(
				here().map(([runId, run]) => [runId, foldRun(run.events).sleep]),
			);
		},
		async waitedFor(projectId: string, signal: string) {
			return here()
				.filter(
					([, run]) =>
						run.projectId === projectId &&
						run.events.some(
							(e) =>
								e.type === "WaitStarted" &&
								(e.payload as { signal?: string }).signal === signal,
						),
				)
				.map(([runId]) => runId);
		},
	};
	return twin satisfies Waits;
}

export type InMemoryWaits = ReturnType<typeof inMemoryWaits>;
