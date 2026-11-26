import { branchPlaces } from "@nightshift/flows";
import type { RunRow, RunState } from "../../log";
import { deriveSteps, firstDeadline } from "../../read";
import {
	ARRIVING,
	RunRefusal,
	type RunStatus,
	WALKED_ELSEWHERE,
} from "../../run-status";
import type { ResumeValue } from "../state";
import { findOverdue } from "./deadlines";
import type { Drives } from "./drive";
import type { ReentryRequest } from "./reentry";
import type { RunnerState, TurnQueue, TurnState } from "./run-slots";
import { type Interrupt, inputOf, type openThread, resumeEach } from "./thread";
import {
	type Intent,
	RestartTooLate,
	type RunnerDeps,
	type Taken,
	type TakeOptions,
} from "./turn";
import {
	type createSleeps,
	holdsGate,
	planWake,
	recordWake,
	type Wake,
} from "./wake";

const DRIVING: Taken = { kind: "driving" };
/** An answer to a Gate on one branch while another branch's step still runs. */
const BRANCHES_WORK =
	"Another branch of this run is still working. Answer the Gate when its step ends.";

/** A resume of a sleeping run whose walk is not where the sleep is. */
const CANNOT_WAKE =
	"Night Shift could not wake this run. Stop the run, then resume it.";

/** An answer to a Gate whose answer the thread holds already. */
const ANSWERED =
	"This Gate has its answer. The run continues when the other branches are done.";
/** An answer to a Gate whose answer the thread had, and went on with. */
const CONTINUED = "This Gate has its answer. The run continues with it.";
/** An answer to a Gate that the walk left behind. */
const GATE_GONE = "This Gate does not wait anymore.";

const HALTED: Taken = { kind: "halted" };
const QUEUED: Taken = { kind: "queued" };
const UNCHANGED: Taken = { kind: "unchanged" };

const isGoing = (status: RunStatus) =>
	status === "running" || status === "waiting" || status === "sleeping";

/**
 * The Turns of one runner (`runner.ts`), one phase per intent: a start,
 * an answer, a Gate's deadline, a wake, a resume or a rerun, a restart, a
 * stop and the end of a step past its time. `turnFor` reads the run's row
 * and its walker (I9, I12), the log and the caller's check, then runs the
 * phase of the intent.
 */
export function createTurns(
	state: RunnerState,
	parts: {
		deps: RunnerDeps;
		open: typeof openThread;
		queue: Pick<TurnQueue, "reserve" | "walkOf">;
		drives: Drives;
		sleeps: ReturnType<typeof createSleeps>;
		/** Whether the run moved here and has not arrived (`runsArriving`). */
		arriving: (runId: string) => Promise<boolean>;
	},
) {
	const { deps, open, drives, sleeps, arriving } = parts;
	const { reserve, walkOf } = parts.queue;
	const {
		drive,
		halt,
		pruneThread,
		reenter,
		takeFromDrive,
		threadOf,
		untilGateClosed,
	} = drives;
	const { shared } = deps;
	const { log, bus, recorders } = shared;
	const { threads, slots } = state;

	/** A start: the slot first, before any await (I2), then `prepare`, then the drive. */
	async function startTurn(
		runId: string,
		intent: Extract<Intent, { kind: "start" }>,
	): Promise<Taken> {
		reserve(runId, intent, {});
		const { row, inputs, stopAt, dueAt } = await intent.prepare();
		drive(row, inputOf({ kind: "start", inputs, stopAt, dueAt }));
		return DRIVING;
	}

	/**
	 * An answer: the thread continues at once, so it needs a slot. A full
	 * cap leaves the Gate open. A Gate on one of parallel branches opens
	 * while the other branches still work: the answer waits until they end.
	 */
	async function answerTurn(
		row: RunRow,
		intent: Extract<Intent, { kind: "answer" }>,
		options: TakeOptions,
	): Promise<Taken> {
		const flow = walkOf(row.id)?.thread?.ctx.flow;
		if (flow && branchPlaces(flow).size > 0) {
			throw new RunRefusal("not-now", BRANCHES_WORK);
		}
		const isThis = ({ value }: Interrupt) =>
			value.kind === "gate" && value.stepId === intent.stepId;
		let snapshot = await threadOf(row).snapshot();
		// A task of the thread took this Gate's answer already: it goes on
		// with the other tasks of its super-step. A second answer would go
		// to one of them.
		if (snapshot.answered.some(isThis)) {
			// No step sleeps beside it: the daemon died after the answer, and
			// recovery ended the steps that ran beside it. Nothing else moves
			// the thread, so this answer does: the Gate goes on with the first.
			// The run goes on when the steps beside it are done: a sleeper
			// wakes, another Gate gets its answer. Then this answer has no use.
			const other = snapshot.state;
			if (
				(await log.state(row.id)).waits.length > 0 ||
				(other.kind === "interrupted" &&
					other.interrupts.some(({ value }) => value.kind === "gate"))
			) {
				throw new RunRefusal("gate-closed", ANSWERED);
			}
			if (!reserve(row.id, intent, options)) return QUEUED;
			const asked =
				(await log.state(row.id)).steps.get(intent.stepId)?.gate?.openedSeq ??
				0;
			drive(row, inputOf({ kind: "continue" }));
			await untilGateClosed(row.id, intent.stepId, asked);
			return DRIVING;
		}
		const before = snapshot.state;
		if (
			(before.kind === "interrupted" && !before.interrupts.some(isThis)) ||
			before.kind === "pending"
		) {
			// The daemon died before the Gate's interrupt was saved: the thread
			// goes on to it first, so the answer reaches its own Gate and no
			// other one.
			if (!reserve(row.id, intent, options)) return QUEUED;
			drive(row, inputOf({ kind: "continue" }));
			await walkOf(row.id)?.done;
			snapshot = await threadOf(row).snapshot();
			const at = snapshot.state;
			if (at.kind !== "interrupted" || !at.interrupts.some(isThis)) {
				// The thread went on past the Gate: with an answer it had, or
				// without one (its step went on before it asked again).
				const step = (await log.state(row.id)).steps.get(intent.stepId);
				const answered = (step?.gateWaits.at(-1)?.answeredBy ?? null) !== null;
				throw new RunRefusal("gate-closed", answered ? CONTINUED : GATE_GONE);
			}
		}
		const at = snapshot.state;
		if (!reserve(row.id, intent, options)) return QUEUED;
		// The Gate's deadline, if it has one, no longer applies.
		sleeps.forget(row.id);
		const { choice, note, byDeadline, data, via } = intent;
		const asked =
			(await log.state(row.id)).steps.get(intent.stepId)?.gate?.openedSeq ?? 0;
		const value: ResumeValue = {
			kind: "gate",
			choice,
			note,
			...(byDeadline ? { byDeadline } : {}),
			...(data !== undefined ? { data } : {}),
			...(via ? { via } : {}),
		};
		// Parallel branches may hold several Gates: the answer goes to its own,
		// by the id of its interrupt. Also when the thread holds only this
		// one while another Gate's task has not reached its interrupt yet:
		// an answer without an id goes to the first interrupt that asks.
		const mine = at.kind === "interrupted" ? at.interrupts.find(isThis) : null;
		const each =
			resumeEach(at, (parked) =>
				parked.kind === "gate" && parked.stepId === intent.stepId
					? value
					: null,
			) ??
			(mine && (await log.state(row.id)).gates.length > 1
				? { [mine.id]: value }
				: null);
		drive(row, inputOf({ kind: "resume", value, ...(each ? { each } : {}) }));
		// The ask node ends the step on the answer, or an Agent's step opens
		// again with it. The Turn ends once the Gate closed, so the run no
		// longer waits when the caller looks again (I8).
		await untilGateClosed(row.id, intent.stepId, asked);
		return DRIVING;
	}

	/**
	 * A timer fired on a run that waits at a Gate with a deadline: the Gate
	 * takes the deadline's option, as an answer would, with a note that says
	 * the deadline chose it. A timer before the deadline is set again. A
	 * Gate a person answered first, or one without a deadline, is left as it
	 * is.
	 */
	async function deadlineTurn(
		row: RunRow,
		runState: RunState,
		options: TakeOptions,
	): Promise<Taken> {
		// Parallel branches may wait at several Gates: the first deadline is due.
		const gate = firstDeadline(runState);
		if (!gate) return UNCHANGED;
		if (shared.now() < gate.deadline.at) {
			sleeps.schedule(row.id, gate.deadline.at);
			return UNCHANGED;
		}
		return answerTurn(
			row,
			{
				kind: "answer",
				stepId: gate.stepId,
				choice: gate.deadline.choose,
				note: "",
				byDeadline: true,
			},
			options,
		);
	}

	/**
	 * A wake (`planWake`): `WaitEnded` and the transcript `wake`
	 * (`recordWake`), then the resume into the wait node. A timer before
	 * its time is set again.
	 */
	async function wakeTurn(
		row: RunRow,
		runState: RunState,
		intent: Intent,
		how: Wake,
		options: TakeOptions,
	): Promise<Taken> {
		const runId = row.id;
		const at = await threadOf(row).state();
		const plan = planWake(runState, at, how, shared.now());
		if (plan.kind === "not-sleeping") {
			// A person asked: they hear that nothing came of it.
			if (intent.kind === "resume" && how.by === "person") {
				throw new RunRefusal("not-now", CANNOT_WAKE);
			}
			return UNCHANGED;
		}
		if (plan.kind === "too-soon") {
			sleeps.schedule(runId, plan.until);
			return UNCHANGED;
		}
		// The timer goes; a wake the cap holds stays queued.
		sleeps.forget(runId);
		if (!reserve(runId, intent, options)) return QUEUED;
		await recordWake({ log, bus, recorders }, runId, plan, how);
		drive(row, inputOf(plan.entry));
		return DRIVING;
	}

	/** A resume or a rerun of a run that is not going. */
	async function reenterTurn(
		row: RunRow,
		intent: Intent,
		request: ReentryRequest,
		options: TakeOptions,
	): Promise<Taken> {
		if (!reserve(row.id, intent, options)) return QUEUED;
		await reenter(row, request);
		return DRIVING;
	}

	/**
	 * A restart: the running drive is taken as a stop takes it, but its
	 * slot stays reserved for the drive that continues the run (I6). A run
	 * the log says runs but no drive in this process holds (its drive died)
	 * is closed the same way: nothing can write to it. The open work ends
	 * `stopped` (`StopRequested`, then `halt`), and the run continues as a
	 * resume continues it, with the action `restart`.
	 *
	 * When the drive ended the run itself just before its fence closed,
	 * there is nothing left to restart: throws `RestartTooLate` with the
	 * run as it ended. When it ended the step but not the run, the run goes
	 * on from the step's end on a new drive, as the old one would have
	 * (the run position finds the step done), and the restart is too late
	 * too.
	 */
	async function restartTurn(
		row: RunRow,
		intent: Extract<Intent, { kind: "restart" }>,
		turn: TurnState,
	): Promise<Taken> {
		const runId = row.id;
		const walk = walkOf(runId);
		if (walk) await takeFromDrive(runId, walk, { keepSlot: true });
		else reserve(runId, intent, {});
		// The old drive may never unwind to free its slot itself.
		turn.freed = true;
		const runState = await log.state(runId);
		const status = runState.status;
		if (!isGoing(status)) throw new RestartTooLate(status);
		if (walk && deriveSteps(runState).every((s) => s.endedAt !== null)) {
			drive(row, inputOf({ kind: "continue" }));
			throw new RestartTooLate(status);
		}
		await log.append({
			type: "StopRequested",
			runId,
			payload: { by: intent.by, restart: true },
		});
		await halt(row, { kind: "stopped" });
		await reenter(row, {
			kind: "resume",
			by: intent.by,
			action: "restart",
			...(intent.prompt !== undefined ? { prompt: intent.prompt } : {}),
		});
		return DRIVING;
	}

	/**
	 * A stop, whatever the drive does: takes the run from the running drive
	 * (`takeFromDrive`) and ends its open work as stopped, or closes a run
	 * that waits at a Gate or sleeps. A run the log says runs but no drive
	 * in this process holds (its drive died, or could not log its end) is
	 * closed the same way: nothing else can end it. Waits on no drive and no
	 * timer: a harness that hangs cannot hold a stop.
	 */
	async function stopTurn(
		row: RunRow,
		intent: Extract<Intent, { kind: "stop" }>,
		turn: TurnState,
	): Promise<Taken> {
		const runId = row.id;
		const walk = walkOf(runId);
		if (walk) {
			await takeFromDrive(runId, walk);
			turn.freed = true;
		}
		const status = (await log.state(runId)).status;
		if (!walk && !isGoing(status)) return UNCHANGED;
		await log.append({
			type: "StopRequested",
			runId,
			payload: { by: intent.by },
		});
		// A drive may have ended the run before the stop took it.
		if (!isGoing(status)) return UNCHANGED;
		await halt(row, { kind: "stopped" });
		return HALTED;
	}

	/**
	 * Ends the run's running step when it ran past its time budget or its
	 * idle limit by `graceMs` or more, as the recorded limits say
	 * (`findOverdue`): the step and the run end as the step's timer ends
	 * them, through the stop's path, so a drive that hangs writes nothing
	 * more.
	 */
	async function overdueTurn(
		row: RunRow,
		runState: RunState,
		graceMs: number,
		turn: TurnState,
	): Promise<Taken> {
		const runId = row.id;
		if (runState.status !== "running") return UNCHANGED;
		const overdue = await findOverdue(
			runState,
			{ now: shared.now(), graceMs, minuteMs: shared.minuteMs },
			log.files(runId),
		);
		if (!overdue) return UNCHANGED;
		const walk = walkOf(runId);
		if (walk) {
			await takeFromDrive(runId, walk);
			turn.freed = true;
		}
		await halt(row, { kind: "overdue", ...overdue });
		return HALTED;
	}

	/** One Turn: the row and the walker (I9), the log, the caller's check, then the intent. */
	async function turnFor(
		runId: string,
		intent: Intent,
		options: TakeOptions,
		turn: TurnState,
	): Promise<Taken> {
		if (intent.kind === "start") return startTurn(runId, intent);
		const row = await log.row(runId);
		if (!(await log.walkedHere(row))) {
			// The sweep and startup recovery look at runs; they refuse nothing.
			if (intent.kind === "overdue" || intent.kind === "prune") {
				return UNCHANGED;
			}
			throw new RunRefusal("walked-elsewhere", WALKED_ELSEWHERE);
		}
		// A drive holds a run that arrived. One without a drive may still
		// arrive: it has no Checkpoint here yet (I12).
		if (!slots.has(runId) && (await arriving(runId))) {
			if (intent.kind === "overdue" || intent.kind === "prune") {
				return UNCHANGED;
			}
			throw new RunRefusal("arriving", ARRIVING);
		}
		if (intent.kind === "prune") {
			// The thread opens for the prune only: a resume opens its own.
			await pruneThread(() => threads.get(runId) ?? open(row, deps), runId);
			return UNCHANGED;
		}
		const runState = await log.state(runId);
		options.check?.(runState);
		switch (intent.kind) {
			case "answer":
				return answerTurn(row, intent, options);
			case "wake":
				// The timer of a Gate's deadline: the run waits, it does not
				// sleep. A Gate whose answer the thread holds waits no more: the
				// timer is a sleeper's beside it (`planWake`).
				if (
					!intent.early &&
					runState.status === "waiting" &&
					holdsGate(await threadOf(row).state())
				) {
					return deadlineTurn(row, runState, options);
				}
				return wakeTurn(row, runState, intent, intent, options);
			case "resume": {
				const { kind: _, ...request } = intent;
				// A sleeping run wakes now, with the person's prompt.
				if (runState.status === "sleeping") {
					const prompt = request.prompt;
					return wakeTurn(
						row,
						runState,
						intent,
						{
							early: true,
							by: request.by,
							...(prompt !== undefined ? { prompt } : {}),
						},
						options,
					);
				}
				return reenterTurn(
					row,
					intent,
					{ kind: "resume", ...request },
					options,
				);
			}
			case "rerun": {
				const { kind: _, ...request } = intent;
				return reenterTurn(row, intent, { kind: "rerun", ...request }, options);
			}
			case "restart":
				return restartTurn(row, intent, turn);
			case "stop":
				return stopTurn(row, intent, turn);
			case "overdue":
				return overdueTurn(row, runState, intent.graceMs, turn);
		}
	}

	return { turnFor };
}
