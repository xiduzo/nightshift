import {
	type Command,
	interrupt,
	type LangGraphRunnableConfig,
} from "@langchain/langgraph";
import { type GateNode, renderTemplate } from "@nightshift/flows";

import type { DerivedStep, GateChoice } from "../../events";
import {
	beginStep,
	messageOf,
	type NodeAction,
	type StepContext,
	type StepHandle,
	uncommittedStep,
} from "../context";
import { route, type StepEnd, scopeOf } from "../route";
import type { Parked, ResumeValue, RunStateValues } from "../state";

/**
 * The Gate node: asks a person the rendered question and waits for one of
 * the choices. Port of `openGate`, the Gate parts of `resolveGate` and
 * `closeParked` in engine.ts. The log and the transcript are written as
 * there: `StepStarted`, `GateOpened { question, choices }` and the
 * transcript `gate-open`; on the answer `StepEnded { outcome: choice,
 * outputs: { outcome, note, visit } }` and the transcript `gate-resolved`.
 *
 * The node interrupts with `{ kind: "gate", stepId, nodeId, question,
 * choices }` and loops until the resume value is `{ kind: "gate", choice,
 * note }`:
 *
 * - `{ kind: "reopen" }`: a person resumed a run that was stopped while the
 *   Gate was open. The runner appended `StepEnded stopped` and `RunEnded`,
 *   and the engine `RunResumed`. The Gate is asked again in a new visit
 *   (`StepStarted` with visit + 1, `GateOpened`, `gate-open`), as the
 *   engine's walk does today after `closeParked`; the node interrupts again.
 * - any other value asks again the same way.
 *
 * Everything before an `interrupt()` re-runs on every resume (design rule
 * 4), and a daemon restart re-runs the node with `invoke(null)` while the
 * Gate is still open. So the opening is guarded by the log: the node looks
 * for the latest step of the node in this scope the graph never committed
 * (`uncommittedStep`). When that step is open with its Gate asked, it is
 * the one (nothing is logged); when it ended (stopped) or there is none,
 * a new visit opens. A re-run that finds the Gate open logs nothing.
 *
 * The engine refuses a choice that is not one of the Gate's before it
 * resumes the thread; the node trusts the value, but ends the step `error`
 * should a bad choice slip through.
 */
export function gateNode(node: GateNode, ctx: StepContext): NodeAction {
	return async (state, config) => {
		let asked = await ensureOpen(ctx, node, state, config);
		if (asked.kind === "parked") return asked.command;
		if (asked.kind === "failed") {
			return route(ctx, state, node, asked.end, config);
		}

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
				return route(ctx, state, node, done.end, config);
			}
			// A reopen, or anything else: ask again.
			asked = await ensureOpen(ctx, node, state, config);
			if (asked.kind === "parked") return asked.command;
			if (asked.kind === "failed") {
				return route(ctx, state, node, asked.end, config);
			}
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
	node: GateNode,
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
				{ outcome: "error", note: "", visit: step.visit },
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
	node: GateNode,
	step: StepHandle,
): Promise<Omit<OpenGate, "kind">> {
	const { stepId, visit } = step;
	try {
		const question = renderTemplate(node.question, step.tctx);
		const choices = node.choices.map((c) =>
			c.description === undefined
				? { name: c.name }
				: { name: c.name, description: c.description },
		);
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
 * `gate-resolved`. The step continues (`beginStep` appends nothing) so its
 * recorder and end are the shared scaffolding's.
 *
 * TODO(context.ts): `beginStep({ kind: "continue" })` is the only way to
 * get a `StepHandle` for a step left open without one, and it also emits
 * `step-started { reopened: true }` on the custom stream and `step-changed`
 * on the bus before the step ends. A `ctx.endStep(stepId, outcome, outputs,
 * error)` plus a `recordOnce`-style transcript write in context.ts would let
 * the Gate end its step without that. Left for after the runner lands.
 */
async function resolve(
	ctx: StepContext,
	node: GateNode,
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
	});
	// A continued step never parks at entry (`beginStep` checks only a new
	// visit); the branch is here for the type. A stop that lands while the
	// Gate is open goes through the runner's `closeParked` instead.
	if (begun.kind === "parked") return begun;
	const step = begun.step;
	const { choice } = answer;
	const note = answer.note ?? "";
	if (!gate.choices.some((c) => c.name === choice)) {
		return {
			kind: "ended",
			end: await step.end(
				"error",
				{ outcome: "error", note: "", visit: step.visit },
				`"${choice}" is not a choice of this Gate. Choose one of: ${gate.choices.map((c) => c.name).join(", ")}.`,
			),
		};
	}
	step.record(null, { type: "gate-resolved", choice, note });
	return {
		kind: "ended",
		end: await step.end(
			choice,
			{ outcome: choice, note, visit: step.visit },
			null,
		),
	};
}
