import { Refusal, wordsFor } from "@nightshift/refusal";
import type { RunEnding, RunEndReason, RunLog, RunRow } from "../../log";
import type { RunResult } from "../../run-status";
import { FencedError } from "../checkpoints";
import type { Parked, RunEvent } from "../state";
import { letGo, type RunHolds } from "./holds";
import { type CloseDeps, type CutShort, closeOpenWork } from "./open-work";
import { planReentry, type ReentryRequest } from "./reentry";
import type { RunnerState, TurnQueue, Walk } from "./run-slots";
import {
	endingOf,
	inputOf,
	type openThread,
	type StreamInput,
	type Thread,
} from "./thread";
import { ENGINE_FAILED, RELEASED, type RunnerDeps } from "./turn";
import type { createSleeps } from "./wake";

export type Drives = ReturnType<typeof createDrives>;

/**
 * The drives of one runner (`runner.ts`): a run's thread, streamed in the
 * background on the slot its Turn reserved (I4), how a drive ended
 * (`RunEnded`), and how a Turn takes a run from its drive (I6), ends its
 * open work, waits for a Gate to close and moves its thread to re-enter.
 */
export function createDrives(
	state: RunnerState,
	parts: {
		deps: RunnerDeps;
		open: typeof openThread;
		holds: RunHolds;
		closeDeps: CloseDeps;
		queue: Pick<TurnQueue, "outside" | "slotFreed">;
		sleeps: ReturnType<typeof createSleeps>;
	},
) {
	const { deps, open, holds, closeDeps, sleeps } = parts;
	const { outside, slotFreed } = parts.queue;
	const { shared } = deps;
	const { log, bus } = shared;
	const { threads, slots } = state;

	/** The run's open thread; opened once per run, from its snapshot. */
	function threadOf(row: RunRow): Thread {
		const cached = threads.get(row.id);
		if (cached) return cached;
		const thread = open(row, deps);
		threads.set(row.id, thread);
		return thread;
	}

	/** Appends `RunEnded` through `writer`: a drive's own fenced log, or the runner's. */
	async function endRun(
		writer: RunLog,
		runId: string,
		status: RunEnding,
		reason: string | null,
		endReason: RunEndReason,
		more: { result?: RunResult; node?: string } = {},
	): Promise<void> {
		try {
			await writer.append({
				type: "RunEnded",
				runId,
				payload: {
					status,
					reason,
					endReason,
					...(more.node !== undefined ? { node: more.node } : {}),
					...(more.result ? { result: more.result } : {}),
				},
			});
			await letGo(holds, runId, status);
		} catch (error) {
			// A stop took the run from the drive and wrote its end.
			if (error instanceof FencedError) return;
			// The next start marks the run interrupted.
			console.error(`[engine] could not record the end of run ${runId}`, error);
		}
	}

	/**
	 * Takes over the Turn's reserved slot and drives the thread in the
	 * background (I4). The slot is released when the drive ends, however it
	 * ends. A released runner begins no drive (I7).
	 */
	function drive(row: RunRow, input: StreamInput): void {
		if (state.released) throw new Refusal("unavailable", RELEASED);
		const runId = row.id;
		const walk: Walk = {
			controller: new AbortController(),
			done: Promise.resolve(),
			thread: null,
		};
		slots.set(runId, walk);
		bus.publish(runId, { kind: "status-changed" });
		// The drive outlives the Turn that began it: it is not part of it.
		walk.done = outside(() =>
			driveThread(row, walk, input).finally(() => {
				if (slots.get(runId) === walk) slots.delete(runId);
				slotFreed(runId);
			}),
		);
	}

	/**
	 * Drives the thread and records how the drive ended. A drive whose
	 * fence a stop closed records nothing: the stop wrote the run's end.
	 */
	async function driveThread(
		row: RunRow,
		walk: Walk,
		input: StreamInput,
	): Promise<void> {
		const runId = row.id;
		let thread: Thread | undefined;
		try {
			// Before the first await: a stop that comes in later finds the thread.
			thread = threadOf(row);
			walk.thread = thread;
			const outcome = await thread.drive(input, {
				controller: walk.controller,
				onEvent: (event) => onCustom(runId, event),
			});
			if (outcome.kind === "parked") onInterrupt(runId, outcome.interrupts);
			const ending = endingOf(outcome);
			if (!ending) {
				// A run that waits or holds a Gate keeps only what its resume
				// reads. The prune does not hold the slot, so an answer that
				// comes at once is not refused: it is safe beside a drive.
				if (outcome.kind === "parked") void pruneThread(thread, runId);
				return;
			}
			dropThread(runId, thread);
			// The prune comes first: once the log says the run ended, a
			// person may resume it, and the slot frees right after the end.
			await pruneThread(thread, runId);
			await endRun(
				thread.ctx.log,
				runId,
				ending.status,
				ending.reason,
				ending.endReason,
				{
					...(ending.result ? { result: ending.result } : {}),
					...(ending.node !== undefined ? { node: ending.node } : {}),
				},
			);
		} catch (error) {
			// A stop took the run from this drive: it writes nothing more.
			if (thread?.fence.closed) return;
			console.error(`[engine] the walk of run ${runId} failed`, error);
			if (thread) await pruneThread(thread, runId);
			await endRun(
				thread?.ctx.log ?? log,
				runId,
				"failed",
				error instanceof Refusal ? error.message : ENGINE_FAILED,
				"_OTHER",
			);
		}
	}

	/** Drops the run's compiled thread from the cache, when it is still `thread`. */
	function dropThread(runId: string, thread: Thread): void {
		if (threads.get(runId) === thread) threads.delete(runId);
	}

	/**
	 * Drops what the run's thread no longer needs (`Thread.prune`): it keeps
	 * the latest root checkpoint and the namespaces of the tasks that are
	 * not done. The event log is the record. What is kept is all a resume,
	 * a restart, a rerun or a wake reads (`planReentry`, `planWake`): a
	 * finished run's final state, or the interrupt or cut-short node of a
	 * run that failed, stopped, waits or holds a Gate, with the body it
	 * parked in.
	 */
	async function pruneThread(
		thread: Thread | (() => Thread),
		runId: string,
	): Promise<void> {
		try {
			await (typeof thread === "function" ? thread() : thread).prune();
		} catch (error) {
			if (error instanceof FencedError) return;
			console.error(
				`[engine] could not prune the checkpoints of run ${runId}`,
				error,
			);
		}
	}

	/** A step started or ended: the run's status may have changed with it. */
	function onCustom(runId: string, event: RunEvent): void {
		if (event.type === "step-started" || event.type === "step-ended") {
			bus.publish(runId, { kind: "status-changed" });
		}
	}

	/**
	 * The root's interrupts ended the drive. A stop that came in while the
	 * wait began or the Gate opened closed the drive's fence, so the drive
	 * never gets here: the stop closed the parked step itself. A `parked`
	 * step ends the run (`endingOf`); a Gate needs nothing. Parallel
	 * branches may sleep at once: the timer is for the earliest wake.
	 */
	function onInterrupt(runId: string, interrupts: readonly Parked[]): void {
		// A wait with no time (a signal with no timeout) has no timer.
		// A Gate with a deadline: the timer answers it then (`deadlineTurn`).
		// Parallel branches may wait at once: the timer is for the earliest.
		const wakes = interrupts.flatMap((parked) =>
			parked.kind === "wait" && parked.until !== null
				? [parked.until]
				: parked.kind === "gate" && parked.deadline
					? [parked.deadline.at]
					: [],
		);
		if (wakes.length > 0) sleeps.schedule(runId, Math.min(...wakes));
	}

	/**
	 * Takes the run from its drive at once, without waiting for it: closes
	 * the drive's fence (it writes nothing more, `fence.ts`), frees its slot
	 * and its compiled thread (a resume drives a new thread while the old
	 * drive unwinds, or hangs), and aborts it (the harness process is
	 * signalled and killed). Resolves once the drive's writes in flight
	 * settled; it waits on no timer (I6).
	 */
	async function takeFromDrive(
		runId: string,
		walk: Walk,
		options: { keepSlot?: boolean } = {},
	): Promise<void> {
		const settled = walk.thread?.fence.close() ?? Promise.resolve();
		if (slots.get(runId) === walk) {
			// A restart keeps the slot for the drive that continues the run,
			// so no other run takes it in between.
			if (options.keepSlot) slots.set(runId, "starting");
			else slots.delete(runId);
		}
		if (walk.thread) dropThread(runId, walk.thread);
		walk.controller.abort();
		await settled;
	}

	/**
	 * Ends the run's open work as `cut` says (`graph/runner/open-work.ts`): its
	 * open sessions, then its open steps from the inside out, then the run.
	 * The run's wake timer goes first. The thread stays where it is: a
	 * resume re-enters it (design rule 7), at its interrupt or at the node
	 * the drive was in.
	 */
	async function halt(row: RunRow, cut: CutShort): Promise<void> {
		sleeps.forget(row.id);
		await closeOpenWork(closeDeps, row.id, cut);
		// The drive's thread is fenced off: the run's open thread prunes.
		await pruneThread(() => threadOf(row), row.id);
	}

	/**
	 * Resolves once the run's log says the Gate of step `stepId` that was
	 * asked at `askedSeq` closed, or no drive holds the run. A Gate closes
	 * when its step ends, or when its step opens again (an Agent goes on
	 * with the answer, and may ask again later). Subscribes before the first
	 * look, so an append between the two is not missed.
	 */
	function untilGateClosed(
		runId: string,
		stepId: string,
		askedSeq: number,
	): Promise<void> {
		return new Promise<void>((resolve) => {
			let settled = false;
			const unsubscribe = bus.subscribe(runId, () => void look());
			async function look(): Promise<void> {
				if (settled) return;
				const runState = await log.state(runId);
				if (settled) return;
				const step = runState.steps.get(stepId);
				const closed =
					!step || step.endedAt !== null || step.openedSeq > askedSeq;
				if (closed || !slots.has(runId)) {
					settled = true;
					unsubscribe();
					resolve();
				}
			}
			void look();
		});
	}

	/**
	 * Plans a re-entry from the log and the thread's latest checkpoint
	 * (`planReentry`, which refuses a run that runs, waits or sleeps),
	 * appends the plan's `RunResumed`, and moves the thread as the plan
	 * says, on the slot the Turn holds (I5). A thread that cannot move ends
	 * the run `failed`, so the log does not say it runs.
	 */
	async function reenter(row: RunRow, request: ReentryRequest): Promise<void> {
		const runId = row.id;
		const thread = threadOf(row);
		const plan = planReentry({
			flow: deps.flowOf(row),
			run: await log.state(runId),
			thread: await thread.snapshot(),
			request,
			now: shared.now(),
		});
		if (state.released) throw new Refusal("unavailable", RELEASED);
		// What it held, it takes again before its next step, or it stays where it is.
		await holds.resuming(row, await log.state(runId), {
			nodeId: plan.resumed.nodeId,
			scope: plan.resumed.scope ?? null,
		});
		await log.append({ type: "RunResumed", runId, payload: plan.resumed });
		try {
			if (plan.clearTasks) await thread.clearTasks();
			drive(row, inputOf(plan.entry));
		} catch (error) {
			// The next engine's recovery takes the run from here.
			if (state.released) throw error;
			if (!(error instanceof Refusal)) {
				console.error(`[engine] run ${runId} could not start again`, error);
			}
			const reason = `The run could not start again. ${wordsFor(error)}`;
			await log.append({
				type: "RunEnded",
				runId,
				payload: {
					status: "failed",
					reason,
					endReason: "_OTHER",
				},
			});
			await letGo(holds, runId, "failed");
			throw error;
		}
	}

	return {
		threadOf,
		drive,
		pruneThread,
		takeFromDrive,
		halt,
		untilGateClosed,
		reenter,
	};
}
