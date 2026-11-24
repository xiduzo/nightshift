import { Command, type LangGraphRunnableConfig } from "@langchain/langgraph";
import type { FlowNode, WaitUntil } from "@nightshift/flows";

import type { LeaseWait, PolicyWaitReason } from "../../log";
import {
	DEFAULT_RESUME_PROMPT,
	type NodeAction,
	type StepContext,
	stopAtOf,
} from "../context";
import { planWait, type WaitStreak } from "../policy";
import { commitVisit, heldStep } from "../position";
import { interruptNode, waitNodeId } from "../route";
import type {
	Pending,
	PendingParked,
	PendingWait,
	RunStateValues,
} from "../state";
import type { OpenStep } from "./step-handle";

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
 * 3. The daemon side, for the runner (`runner/wake.ts`). `planWake`
 *    (pure) says what a wake does: the run still sleeps in the log and in
 *    the checkpoint, a timer before its time is set again, and the resume
 *    value for the wait node. `recordWake` appends `WaitEnded` and the
 *    transcript `wake`. `createSleeps(deps)` holds the wake timers, and
 *    `restore(runId, run)` gives a new daemon its timers from
 *    `deriveSleep` (the log stays the restart source). The slot, the run
 *    cap and the drive into the wait node are the runner's: it wakes a run
 *    in a Turn (`take`).
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

/** A Wait node's own wait, as the node worked it out, or a Lease node's wait for its lease. */
export type OwnWait = {
	reason: WaitUntil["kind"] | "lease";
	/** When the step wakes; null for a wait with no time (a signal with no timeout). */
	until: number | null;
	/** The node's time budget, from its first wait on; the wake is cut to it so the timeout fires as a wake. */
	deadline: number | null;
	message: string;
	/** A wait on a signal: its name. */
	signal?: string;
	/** A wait on a signal with a key: the key, rendered. */
	signalKey?: string;
	/** A wait on a signal whose outcomes have rules: the rules, in order (`signalRules`). */
	signalRules?: { outcome: string; when: string }[];
	/** A Lease node's wait: the lease and its holder (`WaitStarted.lease`). */
	lease?: LeaseWait;
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
	| ({
			kind: "device";
			/**
			 * The step gives up once its Device was offline for the run
			 * policy's network grace (`StepSpec.givesUp`). Without it, the
			 * step sleeps as long as its Device is offline.
			 */
			grace?: true;
	  } & DeviceWait);

/** What `sleep` gives back: the park at the wait node, or why the step must end instead. */
export type SleepOutcome =
	| { kind: "asleep"; command: Command }
	/**
	 * The network grace is spent: the step ends `error`, or as its
	 * `StepSpec.givesUp` says.
	 */
	| { kind: "give-up"; error: string }
	/** The wait would pass the stop time: the step ends `stopped` and the run parks. */
	| { kind: "stop-time"; reason: string };

/** Why the run stopped instead of waiting: the wait would end after the stop time. */
function stopTimeWaitReason(request: WaitRequest): string {
	return request.reason === "usage-limit"
		? `Usage limit: ${request.message}. It resets after the stop time, so the run stopped. Resume the run to continue.`
		: `The network is down: ${request.message}. The next try is after the stop time, so the run stopped. Resume the run to continue.`;
}

/**
 * The pending wait of the step the checkpoint holds for a node (`heldStep`,
 * `graph/position/run-position.ts`), or null when it holds no wait.
 */
export function pendingWaitOf(
	pending: Pending | null | undefined,
): PendingWait | null {
	return pending?.kind === "wait" ? pending : null;
}

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
 * past the network grace gives up. A Device wait gives up past the grace
 * only when the step asks (`grace`). A Wait node's own wait knows no stop
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
		// It looks again in a while, and at the stop time at the latest:
		// that wake ends the step stopped. The Device coming back wakes it
		// sooner.
		const stopAt = stopAtOf(state, config);
		const retry = now + DEVICE_RETRY_MINUTES * ctx.minuteMs;
		// A step that gives up does not look again past the grace, as a
		// network wait does not.
		const grace = request.grace ? ctx.policy().networkGraceMinutes : null;
		if (grace !== null && retry - since > grace * ctx.minuteMs) {
			return {
				kind: "give-up",
				error: `${request.name} was offline for more than ${grace} min.`,
			};
		}
		until = stopAt === null ? retry : Math.min(retry, stopAt);
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
	const lease =
		request.kind === "own" && request.lease !== undefined
			? { lease: request.lease }
			: {};
	const signalRules =
		request.kind === "own" &&
		request.signalRules !== undefined &&
		request.signalRules.length > 0
			? { signalRules: request.signalRules }
			: {};
	// The Device a policy wait is about (a usage limit is its harness
	// login's), or the one that is offline. A Wait node's own wait has none.
	const deviceId =
		request.kind === "device"
			? { deviceId: request.deviceId, deviceName: request.name }
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
			...signalRules,
			...deviceId,
			...lease,
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
		answer(pending, answer) {
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
			letGo: (pending) => stopped(pending, null),
		},
	});
}
