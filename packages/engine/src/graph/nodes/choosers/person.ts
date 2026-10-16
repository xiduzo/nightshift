import {
	type Command,
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
	type StepContext,
	type StepHandle,
	uncommittedStep,
} from "../../context";
import { type StepEnd, scopeOf } from "../../route";
import type { Parked, ResumeValue, RunStateValues } from "../../state";
import { type Chooser, decisionOutputs, visibleOptions } from "../decision";

/**
 * A Decision decided by a person: a Gate. It asks the rendered prompt in
 * the Needs-you inbox and waits for one of the options. The log and the
 * transcript: `StepStarted`, `GateOpened { question, choices }` and the
 * transcript `gate-open`; on the answer `StepEnded { outcome: choice,
 * outputs: { outcome, note, visit } }` and the transcript `gate-resolved`.
 * A Gate waits as long as it must: its step has no time budget.
 *
 * The chooser interrupts with `{ kind: "gate", stepId, nodeId, question,
 * choices }` and loops until the resume value is `{ kind: "gate", choice,
 * note }`:
 *
 * - `{ kind: "reopen" }`: a person resumed a run that was stopped while the
 *   Gate was open. The runner appended `StepEnded stopped` and `RunEnded`,
 *   and the engine `RunResumed`. The Gate is asked again in a new visit
 *   (`StepStarted` with visit + 1, `GateOpened`, `gate-open`), and the
 *   chooser interrupts again.
 * - any other value asks again the same way.
 *
 * Everything before an `interrupt()` re-runs on every resume (design rule
 * 4), and a daemon restart re-runs the node with `invoke(null)` while the
 * Gate is still open. So the opening is guarded by the log: the chooser
 * looks for the latest step of the node in this scope the graph never
 * committed (`uncommittedStep`). When that step is open with its Gate
 * asked, it is the one (nothing is logged); when it ended (stopped) or
 * there is none, a new visit opens. A re-run that finds the Gate open logs
 * nothing.
 *
 * The engine refuses an answer that is not one of the options before it
 * resumes the thread (`optionProblem`); the chooser checks again, and ends
 * the step `error` should a bad one slip through.
 */
export function personChooser(node: DecisionNode, ctx: StepContext): Chooser {
	return async (state, config) => {
		let asked = await ensureOpen(ctx, node, state, config);
		if (asked.kind === "parked") return asked.command;
		if (asked.kind === "failed") return asked.end;

		while (true) {
			const value: Parked = {
				kind: "gate",
				stepId: asked.stepId,
				nodeId: node.id,
				question: asked.question,
				choices: asked.choices,
			};
			const answer = interrupt<Parked, ResumeValue | undefined>(value);
			if (answer?.kind === "gate") {
				const done = await resolve(ctx, node, state, config, asked, answer);
				if (done.kind === "parked") return done.command;
				return done.end;
			}
			// A reopen, or anything else: ask again.
			asked = await ensureOpen(ctx, node, state, config);
			if (asked.kind === "parked") return asked.command;
			if (asked.kind === "failed") return asked.end;
		}
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
 * Leaves an open, asked Gate alone; otherwise (no uncommitted step, or one
 * that ended when the run was stopped) opens a new visit, unless the entry
 * checks park the run instead.
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
	gate: OpenGate,
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
