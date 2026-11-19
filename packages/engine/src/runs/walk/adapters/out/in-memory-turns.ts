import { AsyncLocalStorage } from "node:async_hooks";
import { Refusal } from "@nightshift/refusal";
import type { Held, Intent, Taken, TakeOptions } from "../../../../graph";
import type { RunRow, RunState } from "../../../../log";
import type { Turns } from "../../application/ports";

/** What a released runner says to a Turn (`RELEASED` of `graph/runner/turn.ts`). */
const RELEASED = "Night Shift is restarting. Try again in a moment.";

/** A run as the twin holds it: its row, its state now, and whether a drive holds it. */
type HeldRun = { row: RunRow; runState: RunState; active: boolean };

/**
 * The Turns of runs in memory. It walks nothing: it keeps the order of
 * the Turns of each run (one at a time, first in first out), runs `check`
 * on the run's state of that moment, records each intent it took, and
 * answers what the test scripted (`answer`, default "unchanged"). A Turn
 * from inside a Turn of the same run throws, and after `release` every
 * Turn is refused, as the runner does.
 */
export function inMemoryTurns() {
	const runs = new Map<string, HeldRun>();
	const queues = new Map<string, Promise<unknown>>();
	const within = new AsyncLocalStorage<ReadonlySet<string>>();
	const answers: Taken[] = [];
	let released = false;

	function refuseTurn(runId: string): void {
		if (released) throw new Refusal("unavailable", RELEASED);
		if (within.getStore()?.has(runId)) {
			throw new Error(
				`A Turn of run ${runId} cannot wait for another Turn of the same run.`,
			);
		}
	}

	/** Runs `work` as a Turn of the run, after every earlier Turn of it settled. Rejects, never throws. */
	async function inTurn<T>(runId: string, work: () => Promise<T>): Promise<T> {
		refuseTurn(runId);
		const inside = new Set([...(within.getStore() ?? []), runId]);
		const current = (queues.get(runId) ?? Promise.resolve()).then(() => {
			if (released) throw new Refusal("unavailable", RELEASED);
			return within.run(inside, work);
		});
		queues.set(
			runId,
			current.then(
				() => {},
				() => {},
			),
		);
		return current;
	}

	function runOf(runId: string): HeldRun {
		const run = runs.get(runId);
		if (!run) throw new Error(`The twin has no run ${runId}.`);
		return run;
	}

	const twin = {
		/** Every intent a Turn took, after its check let it through. */
		taken: [] as { runId: string; intent: Intent }[],
		/** The runs `forget` dropped, and the states `restore` set, in order. */
		forgotten: [] as string[],
		restored: [] as { runId: string; state: RunState }[],
		/** Where a moved-in run's transcript continues, by run. */
		continuedAfter: new Map<string, number>(),
		/** Puts a run in the twin: its row, its state, and whether a drive holds it. */
		set(runId: string, run: HeldRun) {
			runs.set(runId, run);
		},
		/** The answer of the next Turns, in order. Then "unchanged". */
		answer(...taken: Taken[]) {
			answers.push(...taken);
		},
		/** Lets go of every run: every Turn from now on is refused. */
		release() {
			released = true;
		},

		take(runId: string, intent: Intent, options: TakeOptions = {}) {
			return inTurn(runId, async (): Promise<Taken> => {
				if (intent.kind !== "start") options.check?.(runOf(runId).runState);
				twin.taken.push({ runId, intent });
				return answers.shift() ?? { kind: "unchanged" };
			});
		},
		hold<T>(
			runId: string,
			work: (held: Held) => Promise<T>,
			_options?: { arrival?: boolean },
		) {
			return inTurn(runId, () => work({ ...runOf(runId) }));
		},
		forget(runId: string) {
			twin.forgotten.push(runId);
		},
		isActive(runId: string) {
			return runs.get(runId)?.active ?? false;
		},
		restore(runId: string, state: RunState) {
			twin.restored.push({ runId, state });
		},
		continueTranscriptAfter(runId: string, seq: number) {
			twin.continuedAfter.set(runId, seq);
		},
	};
	return twin satisfies Turns;
}

export type InMemoryTurns = ReturnType<typeof inMemoryTurns>;
