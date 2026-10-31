import { Command, type LangGraphRunnableConfig } from "@langchain/langgraph";
import {
	type DecisionNode,
	optionProblem,
	renderTemplate,
	type TemplateContext,
} from "@nightshift/flows";

import type { GateChoice, GateDeadline } from "../../../log";
import { messageOf, type NodeAction, type StepContext } from "../../context";
import { openGate, scoreGate } from "../../gate";
import { interruptNode } from "../../interrupt";
import { RESUME_RULES, resumePoint } from "../../resume-point";
import {
	askNodeId,
	route,
	routeDone,
	type StepEnd,
	scopeOf,
} from "../../route";
import type { DoneStep } from "../../run-position";
import type { PendingGate, ResumeValue, RunStateValues } from "../../state";
import { beginStep, type OpenStep } from "../../step-runner";
import { parseTime } from "../wait";
import { type Chooser, decisionOutputs, gateChoices } from "./chooser";

/**
 * A Decision decided by a person: a Gate. It asks the rendered prompt in
 * the Needs-you inbox and waits for one of the options. The log and the
 * transcript: `StepStarted`, `GateOpened { question, choices }` and the
 * transcript `gate-open`; on the answer `StepEnded { outcome: choice,
 * outputs: { outcome, note, visit } }` and the transcript `gate-resolved`.
 * A Gate waits as long as it must: its step has no time budget.
 *
 * Two graph nodes share the work, so the checkpoint knows the Gate is
 * open (a node's writes before an `interrupt()` are never committed):
 *
 * - the node itself (`personChooser`) opens the Gate and commits it as
 *   `pending: { kind: "gate", stepId, nodeId, visit, question, choices }`
 *   with a jump to its ask node;
 * - the ask node (`gateAskNode`, `ask__<id>`) interrupts with that Gate
 *   `{ kind: "gate", stepId, nodeId, question, choices }` and, on
 *   `{ kind: "gate", choice, note }`, ends the step and routes; on
 *   `{ kind: "reopen" }` (a person resumed a run that was stopped while the
 *   Gate was open: the runner appended `StepEnded stopped` and `RunEnded`,
 *   the engine `RunResumed`) it clears `pending` and jumps back to the
 *   node, which asks again in a new visit (`StepStarted` with visit + 1,
 *   `GateOpened`, `gate-open`). Any other value asks again the same way.
 *
 * The engine refuses an answer that is not one of the options before it
 * resumes the thread (`optionProblem`); the ask node checks again, and
 * ends the step `error` should a bad one slip through.
 *
 * A Gate with a `deadline` works out when it is due as it opens (the time
 * rendered and read as a Wait by time reads it, or the minutes from now)
 * and logs it with `GateOpened`, so a restart keeps the same time. The
 * runner sets a timer from the interrupt (and from the log after a
 * restart); when it fires, the runner answers the Gate with the deadline's
 * option (`byDeadline`), and the note says the deadline chose it.
 *
 * The Gate opens and ends its step through the step runner's lower seam
 * (`beginStep`, `OpenStep`), not `runStep`: the step stays open across the
 * ask node's interrupt and ends in another graph node.
 */
export function personChooser(node: DecisionNode, ctx: StepContext): Chooser {
	return async (state, config) => {
		const asked = await ensureOpen(ctx, node, state, config);
		if (asked.kind === "parked") return asked.command;
		if (asked.kind === "done") {
			return routeDone(ctx, state, node, asked.done, config);
		}
		if (asked.kind === "failed")
			return route(ctx, state, node, asked.end, config);
		const pending: PendingGate = {
			kind: "gate",
			stepId: asked.stepId,
			nodeId: node.id,
			visit: asked.visit,
			question: asked.question,
			choices: asked.choices,
			...(asked.deadline ? { deadline: asked.deadline } : {}),
		};
		return new Command({ update: { pending }, goto: askNodeId(node.id) });
	};
}

/** The ask node of a Gate (`interruptNode`): interrupts with the Gate the node opened and ends the step on the answer. */
export function gateAskNode(node: DecisionNode, ctx: StepContext): NodeAction {
	return interruptNode({
		kind: "gate",
		nodeId: node.id,
		missing: `No Gate is open at node "${node.id}".`,
		value: (pending) => ({
			kind: "gate",
			stepId: pending.stepId,
			nodeId: node.id,
			question: pending.question,
			choices: pending.choices,
			...(pending.deadline ? { deadline: pending.deadline } : {}),
		}),
		async answer(pending, answer, state, config) {
			if (answer?.kind !== "gate") {
				// A reopen, or anything else: the node asks again in a new visit.
				return new Command({
					update: { pending: { [node.id]: null } },
					goto: node.id,
				});
			}
			const done = await resolve(ctx, node, state, config, pending, answer);
			if (done.kind === "parked") return done.command;
			return route(ctx, state, node, done.end, config);
		},
		// A stop ended the Gate's step before the Gate was checkpointed: the
		// node asks again in a new visit, as a reopen does.
		stale: {
			ctx,
			letGo: () =>
				new Command({
					update: { pending: { [node.id]: null } },
					goto: node.id,
				}),
		},
	});
}

type OpenGate = {
	kind: "open";
	stepId: string;
	visit: number;
	question: string;
	choices: GateChoice[];
	deadline: GateDeadline | null;
};
type Ensured =
	| OpenGate
	| { kind: "parked"; command: Command }
	/** The Gate was answered before the commit was lost: the node goes on from the answer. */
	| { kind: "done"; done: DoneStep }
	| { kind: "failed"; end: StepEnd };

/**
 * Makes sure a Gate of this node is open in the log, and says what it asks.
 * Opens a new visit, unless the entry checks park the run instead.
 *
 * The resume point (`resumePoint`, `RESUME_RULES.gate`) is the crash-only
 * path: the node's own writes (`pending`) commit with the checkpoint after
 * it returns, so a daemon that dies between `GateOpened` and that commit
 * leaves the Gate open in the log only. The re-run (`invoke(null)`, design
 * rule 5) then finds the latest step of the node in this scope the graph
 * never committed open with its Gate asked (`continue`), and jumps to the
 * ask node with it instead of opening a second Gate. A step that ended (the
 * run was stopped at the Gate) is not reused: a new visit opens.
 */
async function ensureOpen(
	ctx: StepContext,
	node: DecisionNode,
	state: RunStateValues,
	config: LangGraphRunnableConfig,
): Promise<Ensured> {
	const runState = await ctx.log.state(ctx.run.id);
	const point = resumePoint(
		node,
		state,
		runState,
		scopeOf(config),
		RESUME_RULES.gate,
	);
	if (point.kind === "done") return { kind: "done", done: point };
	if (point.kind === "continue" && point.step.gate) {
		const {
			step: own,
			step: { gate },
		} = point;
		return {
			kind: "open",
			stepId: own.id,
			visit: own.visit,
			question: gate.question,
			choices: gate.choices,
			deadline: gate.deadline,
		};
	}
	const begun = await beginStep(
		ctx,
		node,
		state,
		config,
		{ kind: "new" },
		runState,
	);
	if (begun.kind === "parked") return begun;
	const step = begun.step;
	try {
		const asked = await open(ctx, node, step);
		return { kind: "open", ...asked };
	} catch (error) {
		return {
			kind: "failed",
			end: await step.end(
				"error",
				decisionOutputs("error", "", step.visit),
				`The Gate could not open: ${messageOf(error)}`,
			),
		};
	}
}

/**
 * Asks the Gate's question (`openGate`).
 * The step stays open in the log; its recorder and timers close.
 */
async function open(
	ctx: StepContext,
	node: DecisionNode,
	step: OpenStep,
): Promise<Omit<OpenGate, "kind">> {
	const { stepId, visit } = step;
	try {
		const question = renderTemplate(node.prompt, step.tctx);
		const choices = gateChoices(node);
		const deadline = deadlineOf(node, step.tctx, ctx.now(), ctx.minuteMs);
		await openGate(ctx, step, {
			question,
			choices,
			lockScreen: node.lockScreen === true,
			deadline,
		});
		return { stepId, visit, question, choices, deadline };
	} finally {
		step.leaveOpen();
	}
}

/**
 * When the Gate takes its deadline's option, from when it opens (`now`):
 * `minutes` from now, or `at` rendered and read as a Wait by time reads
 * it. Null without a deadline. Throws when `at` is not a valid time: the
 * Gate does not open.
 */
export function deadlineOf(
	node: DecisionNode,
	tctx: TemplateContext,
	now: number,
	minuteMs: number,
): GateDeadline | null {
	const deadline = node.deadline;
	if (deadline === undefined) return null;
	if (deadline.minutes !== undefined) {
		return { at: now + deadline.minutes * minuteMs, choose: deadline.choose };
	}
	const text = renderTemplate(deadline.at ?? "", tctx).trim();
	const at = parseTime(text, now);
	if (at === null) {
		throw new Error(
			`The deadline "${text}" is not valid. Write a date and time like 2026-10-18T07:00, or a time like 07:00.`,
		);
	}
	return { at, choose: deadline.choose };
}

/** The note of a Gate the deadline answered: why nobody's answer chose it. */
function deadlineNote(choice: string): string {
	return `Nobody answered by the deadline, so Night Shift chose "${choice}".`;
}

/**
 * Ends the Gate step on the answer: `StepEnded` with the choice as outcome
 * and `{ outcome, note, visit }` as outputs, and the transcript
 * `gate-resolved`. The step continues quietly (`beginStep` appends and
 * announces nothing: the step did not start again) so its recorder and
 * end are the shared scaffolding's.
 */
async function resolve(
	ctx: StepContext,
	node: DecisionNode,
	state: RunStateValues,
	config: LangGraphRunnableConfig,
	gate: PendingGate,
	answer: Extract<ResumeValue, { kind: "gate" }>,
): Promise<
	{ kind: "parked"; command: Command } | { kind: "ended"; end: StepEnd }
> {
	const begun = await beginStep(ctx, node, state, config, {
		kind: "continue",
		stepId: gate.stepId,
		quiet: true,
	});
	// A continued step never parks at entry (`beginStep` checks only a new
	// visit); the branch is here for the type. A stop that lands while the
	// Gate is open goes through the runner's `closeOpenWork` instead.
	if (begun.kind === "parked") return begun;
	const step = begun.step;
	const { choice } = answer;
	// The deadline chose: the note says so.
	const note = answer.byDeadline ? deadlineNote(choice) : (answer.note ?? "");
	const problem = optionProblem(gate.choices, choice);
	if (problem !== null) {
		return {
			kind: "ended",
			end: await step.end(
				"error",
				decisionOutputs("error", "", step.visit),
				problem,
			),
		};
	}
	step.record(null, {
		type: "gate-resolved",
		choice,
		note,
		...(answer.byDeadline ? { byDeadline: true as const } : {}),
	});
	const end = await step.end(
		choice,
		decisionOutputs(choice, note, step.visit),
		null,
	);
	// After the end: an answer's first event is its StepEnded, which carries
	// the Command that answered (`stampedAppend`).
	await scoreGate(ctx, step.stepId, answer);
	return { kind: "ended", end };
}
