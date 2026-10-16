import {
	Command,
	interrupt,
	type LangGraphRunnableConfig,
} from "@langchain/langgraph";
import {
	type DecisionNode,
	optionProblem,
	renderTemplate,
} from "@nightshift/flows";

import type { DerivedStep, GateChoice } from "../../../events";
import {
	beginStep,
	messageOf,
	type NodeAction,
	type StepContext,
	type StepHandle,
	uncommittedStep,
} from "../../context";
import { askNodeId, route, type StepEnd, scopeOf } from "../../route";
import type {
	Parked,
	PendingGate,
	ResumeValue,
	RunStateValues,
} from "../../state";
import { type Chooser, decisionOutputs, visibleOptions } from "../decision";

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
 */
export function personChooser(node: DecisionNode, ctx: StepContext): Chooser {
	return async (state, config) => {
		const asked = await ensureOpen(ctx, node, state, config);
		if (asked.kind === "parked") return asked.command;
		if (asked.kind === "failed") return asked.end;
		const pending: PendingGate = {
			kind: "gate",
			stepId: asked.stepId,
			nodeId: node.id,
			visit: asked.visit,
			question: asked.question,
			choices: asked.choices,
		};
		return new Command({ update: { pending }, goto: askNodeId(node.id) });
	};
}

/** The ask node of a Gate: interrupts with the Gate the node opened and ends the step on the answer. */
export function gateAskNode(node: DecisionNode, ctx: StepContext): NodeAction {
	return async (state, config) => {
		const pending = state.pending;
		if (pending?.kind !== "gate" || pending.nodeId !== node.id) {
			throw new Error(`No Gate is open at node "${node.id}".`);
		}
		const value: Parked = {
			kind: "gate",
			stepId: pending.stepId,
			nodeId: node.id,
			question: pending.question,
			choices: pending.choices,
		};
		const answer = interrupt<Parked, ResumeValue | undefined>(value);
		if (answer?.kind !== "gate") {
			// A reopen, or anything else: the node asks again in a new visit.
			return new Command({ update: { pending: null }, goto: node.id });
		}
		const done = await resolve(ctx, node, state, config, pending, answer);
		if (done.kind === "parked") return done.command;
		return route(ctx, state, node, done.end, config);
	};
}

type OpenGate = {
	kind: "open";
	stepId: string;
	visit: number;
	question: string;
	choices: GateChoice[];
};
type Ensured =
	| OpenGate
	| { kind: "parked"; command: Command }
	| { kind: "failed"; end: StepEnd };

/** The step's Gate is asked: `GateOpened` came after its latest opening. */
function isAsked(step: DerivedStep): boolean {
	return (
		step.endedAt === null &&
		step.gate !== null &&
		step.gate.openedSeq > step.openedSeq
	);
}

/**
 * Makes sure a Gate of this node is open in the log, and says what it asks.
 * Opens a new visit, unless the entry checks park the run instead.
 *
 * The log guard is the crash-only path: the node's own writes (`pending`)
 * commit with the checkpoint after it returns, so a daemon that dies
 * between `GateOpened` and that commit leaves the Gate open in the log
 * only. The re-run (`invoke(null)`, design rule 5) then finds the latest
 * step of the node in this scope the graph never committed
 * (`uncommittedStep`) open with its Gate asked, and jumps to the ask node
 * with it instead of opening a second Gate. A step that ended (the run was
 * stopped at the Gate) is not reused: a new visit opens.
 */
async function ensureOpen(
	ctx: StepContext,
	node: DecisionNode,
	state: RunStateValues,
	config: LangGraphRunnableConfig,
): Promise<Ensured> {
	const events = await ctx.log.events(ctx.run.id);
	const own = uncommittedStep(node, state, events, scopeOf(config));
	if (own && isAsked(own) && own.gate) {
		return {
			kind: "open",
			stepId: own.id,
			visit: own.visit,
			question: own.gate.question,
			choices: own.gate.choices,
		};
	}
	const begun = await beginStep(ctx, node, state, config, { kind: "new" });
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
 * Asks the Gate's question. The fact goes in the log first, so the Gate is
 * open even when the daemon dies before the transcript line is written.
 * The step stays open in the log; its recorder and timers close.
 */
async function open(
	ctx: StepContext,
	node: DecisionNode,
	step: StepHandle,
): Promise<Omit<OpenGate, "kind">> {
	const { stepId, visit } = step;
	try {
		const question = renderTemplate(node.prompt, step.tctx);
		const choices = visibleOptions(node);
		await ctx.log.append({
			type: "GateOpened",
			runId: ctx.run.id,
			stepId,
			payload: { question, choices },
		});
		step.record(null, { type: "gate-open", question, choices });
		ctx.bus.publish(ctx.run.id, { kind: "step-changed", stepId });
		return { stepId, visit, question, choices };
	} finally {
		step.leaveOpen();
	}
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
	// Gate is open goes through the runner's `closeParked` instead.
	if (begun.kind === "parked") return begun;
	const step = begun.step;
	const { choice } = answer;
	const note = answer.note ?? "";
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
	step.record(null, { type: "gate-resolved", choice, note });
	return {
		kind: "ended",
		end: await step.end(
			choice,
			decisionOutputs(choice, note, step.visit),
			null,
		),
	};
}
