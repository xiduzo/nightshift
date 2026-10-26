import { Command, type LangGraphRunnableConfig } from "@langchain/langgraph";
import type { FlowNode, JsonValue, WaitUntil } from "@nightshift/flows";

import type { LoggedEvent, PolicyWaitReason, RunBus, RunLog } from "../log";
import {
	type DerivedStep,
	deriveRunState,
	deriveSleep,
	deriveSteps,
	firstDeadline,
} from "../read";
import {
	DEFAULT_RESUME_PROMPT,
	type NodeAction,
	type Recorder,
	type StepContext,
	stopAtOf,
} from "./context";
import { interruptNode } from "./interrupt";
import { planWait, type WaitStreak } from "./policy";
import { waitNodeId } from "./route";
import { commitVisit, heldStep } from "./run-position";
import type {
	Parked,
	Pending,
	PendingParked,
	PendingWait,
	ResumeValue,
	RunStateValues,
} from "./state";
import type { OpenStep } from "./step-runner";
import type { ThreadState } from "./thread";

/**
 * The sleep module: one deep module owns a sleep from the moment a step
 * asks for one to the moment the step continues. A sleep is a usage-limit
 * or network wait of an Agent step, a model Decision or a model Value (the
 * run policy plans it, `policy.ts`), or a Wait node's own wait (the node
 * works out the time). Both go through the same path here:
 *
 * 1. `sleep(ctx, node, state, config, step, request)`: the interface for
 *    the step runner. Plans the wait (`planWait` for the policy, the node's
 *    own `until` cut to its deadline for a Wait node), refuses a policy wait
 *    that would pass the stop time or spend the grace, and persists the
 *    sleep: `WaitStarted`, the transcript `wait` entry, the bus, the step
 *    left open, and `pending` (the one shape, `PendingWait`) with a jump to
 *    the node's wait node.
 * 2. `waitNode(nodeId)`: the interrupting graph node (`wait__<id>`, design
 *    rule 8). It carries the sleep to the runner and answers a `wake` (the
 *    step continues with its prompt), a `signal` (the Wait node reads
 *    `pending.signal`) and a `resume` (the run was stopped while it slept:
 *    the step parks as stopped and the node reopens or restarts it).
 * 3. The daemon side, for the runner. `planWake` (pure) says what a wake
 *    does: the run still sleeps in the log and in the checkpoint, a timer
 *    before its time is set again, and the resume value for the wait node.
 *    `recordWake` appends `WaitEnded` and the transcript `wake`.
 *    `createSleeps(deps)` holds the wake timers, and `restore(runId,
 *    events)` gives a new daemon its timers from `deriveSleep` (the log
 *    stays the restart source). The slot, the run cap and the drive into
 *    the wait node are the runner's: it wakes a run in a Turn (`take`).
 *
 * Before this module the same sequence lived in five files: `beginWait` in
 * context.ts, the Wait node's private `sleep()`, `graph/wait.ts`, the
 * runner's timers and wake, and recovery's startup wiring. Locality: a
 * change to how a run sleeps lands here. Leverage: `sleep.test.ts` covers
 * plan, persist, interrupt and wake for both kinds of wait once. The log is
 * written exactly as before (design rule 3). `policy.ts` stays pure.
 */

/** A usage limit or a network failure: the run policy plans the wait. */
export type WaitRequest = {
	reason: PolicyWaitReason;
	/** The harness's or the decider's error message. */
	message: string;
	resetAt: number | null;
	/** The harness session the step continues after the wait, if it has one. */
	harnessSessionId: string | null;
};

/** A Wait node's own wait, as the node worked it out. */
export type OwnWait = {
	reason: WaitUntil["kind"];
	/** When the step wakes; null for a wait with no time (a signal with no timeout). */
	until: number | null;
	/** The node's time budget, from its first wait on; the wake is cut to it so the timeout fires as a wake. */
	deadline: number | null;
	message: string;
	/** A wait on a signal: its name. */
	signal?: string;
	/** A wait on a signal with a key: the key, rendered. */
	signalKey?: string;
};

/** The step's Device (or the one its work must move from) is offline. */
export type DeviceWait = {
	reason: "device-offline";
	deviceId: string;
	/** The Device's name, for the message. */
	name: string;
};

/** How often a step whose Device is offline looks again, in minutes, besides the wake when it is back. */
export const DEVICE_RETRY_MINUTES = 1;

/** What a step asks the sleep module for. */
export type SleepRequest =
	| ({ kind: "policy" } & WaitRequest)
	| ({ kind: "own" } & OwnWait)
	| ({ kind: "device" } & DeviceWait);

/** What `sleep` gives back: the park at the wait node, or why the step must end instead. */
export type SleepOutcome =
	| { kind: "asleep"; command: Command }
	/** The network grace is spent: the step ends `error`. */
	| { kind: "give-up"; error: string }
	/** The wait would pass the stop time: the step ends `stopped` and the run parks. */
	| { kind: "stop-time"; reason: string };

const isPolicyReason = (reason: PendingWait["reason"]): boolean =>
	reason === "usage-limit" || reason === "network";

/** Why the run stopped instead of waiting: the wait would end after the stop time. */
function stopTimeWaitReason(request: WaitRequest): string {
	return request.reason === "usage-limit"
		? `Usage limit: ${request.message}. It resets after the stop time, so the run stopped. Resume the run to continue.`
		: `The network is down: ${request.message}. The next try is after the stop time, so the run stopped. Resume the run to continue.`;
}

/**
 * A pending wait in today's shape: the one place that reads `pending` as a
 * sleep. A node passes the step the checkpoint holds for it
 * (`heldStep`, `graph/run-position.ts`).
 *
 * A checkpoint written before this module holds the wait's continuation
 * flat next to it (`harnessSessionId`, `prompt`, `resetAt`): a run that
 * slept across the upgrade is read as it is and written back in today's
 * shape on its next wake. `resetAt` was never read and is dropped.
 */
export function pendingWaitOf(
	pending: Pending | null | undefined,
): PendingWait | null {
	if (pending?.kind !== "wait") return null;
	const raw = pending as PendingWait | LegacyPendingWait;
	if ("session" in raw) return raw;
	const { harnessSessionId, prompt, resetAt: _, ...wait } = raw;
	return {
		...wait,
		session: isPolicyReason(raw.reason) ? { harnessSessionId, prompt } : null,
	};
}

/** The shape of a pending wait before the sleep module (checkpoints up to 2026-10-19). */
type LegacyPendingWait = Omit<PendingWait, "session"> & {
	harnessSessionId: string | null;
	prompt: string;
	resetAt: number | null;
};

/**
 * The step's streak of waits for this reason: the pending wait's when the
 * step continues after a wait for the same reason; else a new streak. For
 * a Wait node, whose reason never changes, that is every sleep of the step.
 */
function streakOf(
	state: RunStateValues,
	node: FlowNode,
	step: OpenStep,
	reason: PendingWait["reason"],
): WaitStreak | null {
	const previous = pendingWaitOf(heldStep(state, node.id));
	return step.opened === "continue" &&
		previous?.stepId === step.stepId &&
		previous.reason === reason
		? previous.streak
		: null;
}

/** A wake time cut to the deadline: a wait with no time wakes at the deadline, if there is one. */
function cutToDeadline(
	until: number | null,
	deadline: number | null,
): number | null {
	if (deadline === null) return until;
	return until === null ? deadline : Math.min(until, deadline);
}

/**
 * Puts the step to sleep: plans the wait and persists it. On `asleep`, the
 * log has `WaitStarted`, the transcript its `wait` entry, the bus was told,
 * the step's recorder and timers are closed with the step left open, and
 * the returned `Command` parks the run at the node's wait node with the
 * pending wait (and the node's visit, so the checkpoint counts it). The
 * runner appends `WaitEnded` and the transcript `wake` on the wake
 * (`createSleeps`), not the node.
 *
 * A policy wait that would end after the stop time is not started
 * (`stop-time`: the step ends `stopped`, a resume continues it), and one
 * past the network grace gives up. A Wait node's own wait knows no stop
 * time: the step runner ends a continued step past it on the wake.
 */
export async function sleep(
	ctx: StepContext,
	node: FlowNode,
	state: RunStateValues,
	config: LangGraphRunnableConfig,
	step: OpenStep,
	request: SleepRequest,
): Promise<SleepOutcome> {
	const runId = ctx.run.id;
	const now = ctx.now();
	const streak = streakOf(state, node, step, request.reason);
	const since = streak?.since ?? now;
	let until: number | null;
	let message: string;
	if (request.kind === "policy") {
		const plan = planWait({
			reason: request.reason,
			streak,
			message: request.message,
			resetAt: request.resetAt,
			policy: ctx.policy(),
			now,
			minuteMs: ctx.minuteMs,
		});
		if (plan.kind === "give-up") return { kind: "give-up", error: plan.error };
		// A wait that ends after the stop time would only continue the step
		// past it: the run stops now, and a resume continues the step.
		const stopAt = stopAtOf(state, config);
		if (stopAt !== null && plan.until >= stopAt) {
			return { kind: "stop-time", reason: stopTimeWaitReason(request) };
		}
		until = plan.until;
		message = plan.message;
	} else if (request.kind === "device") {
		// It looks again in a while; the Device coming back wakes it sooner.
		until = now + DEVICE_RETRY_MINUTES * ctx.minuteMs;
		message = `${request.name} is offline. The step starts when it is back.`;
	} else {
		until = cutToDeadline(request.until, request.deadline);
		message = request.message;
	}
	const signal =
		request.kind === "own" && request.signal !== undefined
			? { signal: request.signal }
			: {};
	const signalKey =
		request.kind === "own" && request.signalKey !== undefined
			? { signalKey: request.signalKey }
			: {};
	// The Device a policy wait is about (a usage limit is its harness
	// login's), or the one that is offline. A Wait node's own wait has none.
	const deviceId =
		request.kind === "device"
			? { deviceId: request.deviceId }
			: request.kind === "policy"
				? { deviceId: step.device.id }
				: {};
	await ctx.log.append({
		type: "WaitStarted",
		runId,
		stepId: step.stepId,
		payload: {
			reason: request.reason,
			until,
			message,
			since,
			...signal,
			...signalKey,
			...deviceId,
		},
	});
	step.record(null, {
		type: "wait",
		reason: request.reason,
		until,
		message,
		...signal,
	});
	ctx.bus.publish(runId, { kind: "step-changed", stepId: step.stepId });
	step.leaveOpen();
	const pending: PendingWait = {
		kind: "wait",
		stepId: step.stepId,
		nodeId: node.id,
		visit: step.visit,
		reason: request.reason,
		until,
		message,
		streak: { count: (streak?.count ?? 0) + 1, since },
		session:
			request.kind === "policy"
				? {
						harnessSessionId: request.harnessSessionId,
						prompt: DEFAULT_RESUME_PROMPT,
					}
				: null,
	};
	return {
		kind: "asleep",
		command: new Command({
			update: { pending, ...commitVisit(node, step.visit) },
			goto: waitNodeId(node.id),
		}),
	};
}

/**
 * The wait node of an Agent node, a Decision or Value by a model, or a Wait
 * node (`wait__<id>`, design rule 8). It interrupts with the sleep (the
 * runner schedules the wake timer from it) and, on the resume, jumps back
 * to the node:
 *
 * - a `wake` continues the step with its prompt (the wake's, else the
 *   pending one); the node continues the same step and harness session;
 * - a `signal` (someone sent the run a signal) continues the step with the
 *   signal's name in `pending.signal`; a Wait node on it ends `done`;
 * - a `resume` (the run was stopped while it slept, and a person resumed
 *   it) parks the step as stopped and jumps back, so the node reopens the
 *   step when it has a session, else starts its next visit, as the engine
 *   does after `closeOpenWork`. A sleep a stop ended before it was
 *   checkpointed does the same with no answer (`interruptNode`'s `stale`).
 */
export function waitNode(
	nodeId: string,
	ctx: Pick<StepContext, "log" | "run">,
): NodeAction {
	const stopped = (pending: PendingWait, prompt: string | null): Command => {
		const parked: PendingParked = {
			kind: "parked",
			stepId: pending.stepId,
			nodeId,
			visit: pending.visit,
			harnessSessionId: pending.session?.harnessSessionId ?? null,
			prompt,
			status: "stopped",
			reason: null,
		};
		return new Command({ update: { pending: parked }, goto: nodeId });
	};
	return interruptNode({
		kind: "wait",
		nodeId,
		missing: `Nothing waits at node "${nodeId}".`,
		value: (pending) => ({
			kind: "wait",
			stepId: pending.stepId,
			nodeId,
			reason: pending.reason,
			until: pending.until,
			message: pending.message,
		}),
		answer(raw, answer) {
			// A checkpoint from before this module is read in today's shape.
			const pending = pendingWaitOf(raw) as PendingWait;
			if (answer?.kind === "resume") {
				return stopped(pending, answer.prompt ?? null);
			}
			if (answer?.kind === "signal") {
				return new Command({
					update: {
						pending: {
							...pending,
							signal: answer.name,
							...(answer.data !== undefined ? { signalData: answer.data } : {}),
						},
					},
					goto: nodeId,
				});
			}
			const session =
				pending.session &&
				answer?.kind === "wake" &&
				answer.prompt !== undefined
					? { ...pending.session, prompt: answer.prompt }
					: pending.session;
			return new Command({
				update: { pending: { ...pending, session } },
				goto: nodeId,
			});
		},
		// A stop ended the step before the sleep was checkpointed: it parks as
		// stopped, as a resume of a stopped sleep does.
		stale: {
			ctx,
			letGo: (raw) => stopped(pendingWaitOf(raw) as PendingWait, null),
		},
	});
}

/** setTimeout cannot wait longer; a longer wait checks the clock and waits again. */
const MAX_TIMER_MS = 2 ** 31 - 1;

/**
 * How a sleep ends: the timer, a person early (with a follow-up), or a
 * signal, with the webhook event that sent it as `data`.
 */
export type Wake = {
	early: boolean;
	prompt?: string;
	signal?: string;
	data?: JsonValue;
};

/** What a wake does to a run, from its log and its thread (`planWake`). */
export type WakePlan =
	/** The run no longer sleeps (a stop ended the sleep, or it woke already): nothing happens. */
	| { kind: "not-sleeping" }
	/** A timer that fired before its time: it is set again for `until`. */
	| { kind: "too-soon"; until: number }
	/** The wait ends: `WaitEnded` on `step`, then `resume` into the wait node. */
	| {
			kind: "wake";
			step: Pick<DerivedStep, "id">;
			resume: ResumeValue;
	  };

/**
 * Pure: what a wake does. The run must still sleep by the log (a stop ends
 * the sleep with the thread left at its wait) and by the checkpoint (the
 * wait is the interrupt the thread sits at). A timer's wake (`early`
 * false) before the wait's time is too soon.
 *
 * `early`: a person resumed the run before its time, with `prompt` as the
 * step's follow-up. `signal`: someone sent the run that signal; the resume
 * is `{ kind: "signal" }` and the Wait node on it ends `done`.
 */
export function planWake(
	events: readonly LoggedEvent[],
	at: ThreadState,
	how: Wake,
	now: number,
): WakePlan {
	if (deriveRunState(events).status !== "sleeping") {
		return { kind: "not-sleeping" };
	}
	if (at.kind !== "interrupted") return { kind: "not-sleeping" };
	const steps = deriveSteps(events);
	const sleeping = sleepingBranch(events, steps, at, how);
	if (!sleeping) return { kind: "not-sleeping" };
	if (!how.early && sleeping.until !== null && now < sleeping.until) {
		return { kind: "too-soon", until: sleeping.until };
	}
	const step = steps.find((s) => s.id === sleeping.stepId);
	if (!step) throw new Error(`Step not found: ${sleeping.stepId}`);
	const resume: ResumeValue =
		how.signal !== undefined
			? {
					kind: "signal",
					name: how.signal,
					...(how.data !== undefined ? { data: how.data } : {}),
				}
			: {
					kind: "wake",
					early: how.early,
					...(how.prompt !== undefined ? { prompt: how.prompt } : {}),
				};
	return { kind: "wake", step, resume };
}

/**
 * The wait a wake ends. One wait: the one the thread sits at. Parallel
 * branches may sleep at once: a signal ends the wait for that signal, and
 * a timer or a person the one that wakes first. A wait whose step a stop
 * ended does not count.
 */
function sleepingBranch(
	events: readonly LoggedEvent[],
	steps: readonly DerivedStep[],
	at: Extract<ThreadState, { kind: "interrupted" }>,
	how: Wake,
): Extract<Parked, { kind: "wait" }> | null {
	const waits = at.interrupts.flatMap(({ value }) =>
		value.kind === "wait" &&
		steps.find((s) => s.id === value.stepId)?.endedAt === null
			? [value]
			: [],
	);
	if (waits.length < 2) {
		return at.value.kind === "wait" ? at.value : (waits[0] ?? null);
	}
	if (how.signal !== undefined) {
		const forSignal = waits.find((wait) =>
			events.some(
				(e) =>
					e.type === "WaitStarted" &&
					e.stepId === wait.stepId &&
					e.payload.signal === how.signal,
			),
		);
		if (forSignal) return forSignal;
	}
	const first = (wait: { until: number | null }) =>
		wait.until ?? Number.POSITIVE_INFINITY;
	return [...waits].sort((a, b) => first(a) - first(b))[0] ?? null;
}

/** What `recordWake` writes to. */
export type WakeDeps = {
	log: RunLog;
	bus: RunBus;
	recorders: {
		open(runId: string, stepId: string): Promise<Recorder>;
	};
};

/**
 * Records the end of a sleep: `WaitEnded` on the step that waited, the
 * transcript `wake` entry, and the bus. The runner calls it in the wake's
 * Turn, once the woken run holds a slot and before the thread moves.
 */
export async function recordWake(
	deps: WakeDeps,
	runId: string,
	plan: Extract<WakePlan, { kind: "wake" }>,
	how: Wake,
): Promise<void> {
	const { step } = plan;
	const signal = how.signal !== undefined ? { signal: how.signal } : {};
	await deps.log.append({
		type: "WaitEnded",
		runId,
		stepId: step.id,
		payload: { early: how.early, ...signal },
	});
	const recorder = await deps.recorders.open(runId, step.id);
	try {
		recorder.record(null, { type: "wake", ...signal });
	} finally {
		recorder.close();
	}
	deps.bus.publish(runId, { kind: "step-changed", stepId: step.id });
}

/** What the wake timers need: the clock, and who wakes a run when its timer fires. */
export type SleepDeps = {
	now(): number;
	/** The timer of the run fired: the runner takes the run to wake it. */
	wake(runId: string): void;
};

export type Sleeps = ReturnType<typeof createSleeps>;

/**
 * The wake timers of sleeping runs, and of runs that wait at a Gate with a
 * deadline. One per runner, one timer per run. A timer that fires hands
 * the run to `deps.wake`; the runner then wakes it in a Turn (`planWake`,
 * `recordWake`) or answers its Gate, or queues it on a full run cap.
 */
export function createSleeps(deps: SleepDeps) {
	/** Timers that end the waits of sleeping runs, by run id. */
	const timers = new Map<string, ReturnType<typeof setTimeout>>();
	let disposed = false;

	/** Clears every timer and sets no new one: the daemon dies. */
	function dispose(): void {
		disposed = true;
		for (const timer of timers.values()) clearTimeout(timer);
		timers.clear();
	}

	/** Drops the run's timer: the run woke, was stopped, or moved. */
	function forget(runId: string): void {
		const timer = timers.get(runId);
		if (timer !== undefined) clearTimeout(timer);
		timers.delete(runId);
	}

	/** Wakes the run at `until` (at once when it has passed). Replaces an earlier timer. */
	function schedule(runId: string, until: number): void {
		forget(runId);
		if (disposed) return;
		const delay = Math.min(Math.max(0, until - deps.now()), MAX_TIMER_MS);
		const timer = setTimeout(() => {
			timers.delete(runId);
			deps.wake(runId);
		}, delay);
		timer.unref?.();
		timers.set(runId, timer);
	}

	/**
	 * A new daemon's timer for a run that slept when the last one died, from
	 * the log (`deriveSleep`: the latest `WaitStarted` with no `WaitEnded`,
	 * on an open step of a run that has not ended). A wait with no time (a
	 * signal with no timeout) gets no timer. A run that waits at a Gate with
	 * a deadline gets the deadline's timer: the runner answers the Gate when
	 * it fires.
	 */
	function restore(runId: string, events: readonly LoggedEvent[]): void {
		const sleeping = deriveSleep(events);
		if (sleeping?.until != null) schedule(runId, sleeping.until);
		const deadline = firstDeadline(events)?.deadline;
		if (deadline) schedule(runId, deadline.at);
	}

	return { schedule, restore, forget, dispose };
}
