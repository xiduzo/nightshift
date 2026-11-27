import { AsyncLocalStorage } from "node:async_hooks";
import { Refusal } from "@nightshift/refusal";
import { RunRefusal, STILL_RUNNING } from "../../run-status";
import type { Thread } from "./thread";
import {
	type Intent,
	RELEASED,
	type RunnerDeps,
	type Taken,
	type TakeOptions,
} from "./turn";

/**
 * The state of one runner (`runner.ts`) and its Turn queue: the slots of
 * the runs that walk in this process, the per-run queues of Turns, the cap
 * queue, and whether the runner was released. Invariants I1, I2, I3, I7,
 * I10 and I11 of `runner.ts` live here.
 */

/** How long `release` waits for the Turns in flight. */
const RELEASE_WAIT_MS = 5_000;

export type Walk = {
	/** Aborts when a person stops the run. */
	controller: AbortController;
	done: Promise<void>;
	/** The thread the drive streams; null until the drive compiled it. */
	thread: Thread | null;
	/**
	 * A Turn waits for the run: the drive parks at its next hold instead of
	 * holding again (`driveGraph`), so the Turn can answer or wake there.
	 * `hand-over`: the drive's slot goes to that Turn ("handed"), so a full
	 * run cap cannot hold it back.
	 */
	yielding: false | "park" | "hand-over";
};

/**
 * "starting": reserved by the Turn that holds it, before its drive began
 * (I3). "handed": a drive that parked for a Turn kept it for that Turn
 * (`Walk.yielding`); the Turn takes it with `reserve`, or lets it go.
 */
export type Slot = Walk | "starting" | "handed";

/** What a Turn of a run did to its slot, for the end of the Turn. */
export type TurnState = { freed: boolean };

/** What one runner keeps, per run, while it runs. */
export type RunnerState = {
	/** Open threads by run id, kept while the run is likely to continue soon. */
	threads: Map<string, Thread>;
	/** Keyed by run id: the runs that walk in this process. */
	slots: Map<string, Slot>;
	/** Per-run queues of Turns (I1). */
	queues: Map<string, Promise<void>>;
	/** The Turns that began and have not ended, for `release`. */
	inFlight: Set<Promise<void>>;
	/** Turns a full run cap holds, by run id, in order: what each runs when a slot frees (I10). */
	capQueue: Map<string, () => void>;
	/** The runs whose Turn the current async context is in (I11). */
	turnOf: AsyncLocalStorage<ReadonlySet<string>>;
	/** Set once by `release` (I7). */
	released: boolean;
};

/** The state of a new runner: no run walks, nothing is queued. */
export function createRunnerState(): RunnerState {
	return {
		threads: new Map(),
		slots: new Map(),
		queues: new Map(),
		inFlight: new Set(),
		capQueue: new Map(),
		turnOf: new AsyncLocalStorage(),
		released: false,
	};
}

export type TurnQueue = ReturnType<typeof createTurnQueue>;

/** The Turns of a runner: their queue per run, the slots they reserve and the cap. */
export function createTurnQueue(
	state: RunnerState,
	deps: {
		shared: RunnerDeps["shared"];
		/** The runner's own `take`, for a Turn the cap queue retries. */
		take: (
			runId: string,
			intent: Intent,
			options: TakeOptions,
		) => Promise<Taken>;
	},
) {
	const { shared, take } = deps;
	const { bus } = shared;
	const { slots, queues, inFlight, capQueue, turnOf } = state;

	/** Runs `fn` outside any Turn: what it starts is not part of the Turn that started it. */
	const outside = <T>(fn: () => T): T => turnOf.exit(fn);

	/** Waits for the Turns in flight, up to `RELEASE_WAIT_MS`. */
	async function settleTurns(): Promise<void> {
		if (inFlight.size === 0) return;
		let timer: ReturnType<typeof setTimeout> | undefined;
		await Promise.race([
			Promise.allSettled([...inFlight]),
			new Promise<void>((resolve) => {
				timer = setTimeout(resolve, RELEASE_WAIT_MS);
				timer.unref?.();
			}),
		]);
		clearTimeout(timer);
	}

	/** The drive that holds the run's slot, if one does. */
	function walkOf(runId: string): Walk | undefined {
		const slot = slots.get(runId);
		return slot === "starting" || slot === "handed" ? undefined : slot;
	}

	/** Throws when no Turn of `runId` may be asked for here: released (I7), or inside one (I11). */
	function refuseTurn(runId: string): void {
		if (state.released) throw new Refusal("unavailable", RELEASED);
		if (turnOf.getStore()?.has(runId)) {
			throw new Error(
				`A Turn of run ${runId} cannot wait for another Turn of the same run.`,
			);
		}
	}

	/**
	 * Runs `fn` as a Turn of the run: after every earlier Turn of it has
	 * settled (I1). At its end, a slot still "starting" is freed, and a
	 * freed slot lets the cap queue go.
	 */
	function inTurn<T>(
		runId: string,
		fn: (turn: TurnState) => Promise<T>,
	): Promise<T> {
		refuseTurn(runId);
		const within = new Set([...(turnOf.getStore() ?? []), runId]);
		const previous = queues.get(runId) ?? Promise.resolve();
		const current = previous.then(() => {
			if (state.released) throw new Refusal("unavailable", RELEASED);
			return turnOf.run(within, () => runTurn(runId, fn));
		});
		const tail = current.then(
			() => {},
			() => {},
		);
		queues.set(runId, tail);
		void tail.then(() => {
			if (queues.get(runId) === tail) queues.delete(runId);
		});
		return current;
	}

	async function runTurn<T>(
		runId: string,
		fn: (turn: TurnState) => Promise<T>,
	): Promise<T> {
		const turn: TurnState = { freed: false };
		const running = fn(turn);
		const settled = running.then(
			() => {},
			() => {},
		);
		inFlight.add(settled);
		try {
			return await running;
		} finally {
			inFlight.delete(settled);
			if (slots.get(runId) === "starting") {
				slots.delete(runId);
				turn.freed = true;
			}
			if (turn.freed) slotFreed(runId);
		}
	}

	/**
	 * Holds a slot for the run, in one synchronous step (I2). Throws when a
	 * drive holds it already, and on a full run cap unless `whenFull` is
	 * "queue": then the Turn waits in the cap queue, and this says false.
	 */
	function reserve(
		runId: string,
		intent: Intent,
		options: TakeOptions,
	): boolean {
		// The slot a drive kept for this run's Turn: it counts in the cap already.
		if (slots.get(runId) === "handed") {
			slots.set(runId, "starting");
			return true;
		}
		if (slots.has(runId)) throw new RunRefusal("not-now", STILL_RUNNING);
		const runCap = shared.settings().maxConcurrentRuns;
		if (slots.size >= runCap) {
			if (options.whenFull === "queue") {
				capQueue.set(
					runId,
					options.retry ??
						(() => {
							take(runId, intent, options).catch((error) => {
								console.error(`[engine] could not take run ${runId}`, error);
							});
						}),
				);
				return false;
			}
			throw new Refusal(
				"conflict",
				`The run cap is reached: ${slots.size} of ${runCap} runs are running. Stop a run or wait for one to end.`,
			);
		}
		slots.set(runId, "starting");
		return true;
	}

	/** A slot is free: the bus hears it, and every Turn the cap queue holds tries once more (I10). */
	function slotFreed(runId: string): void {
		bus.publish(runId, { kind: "status-changed" });
		if (state.released) return;
		const retries = [...capQueue.values()];
		capQueue.clear();
		for (const retry of retries) outside(retry);
	}

	return {
		outside,
		settleTurns,
		walkOf,
		refuseTurn,
		inTurn,
		reserve,
		slotFreed,
	};
}
