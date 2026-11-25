import { Command } from "@langchain/langgraph";
import type { AgentNode } from "@nightshift/flows";
import type { GateChoice, StepOutputs } from "../../../log";
import {
	DEFAULT_RESUME_PROMPT,
	type NodeAction,
	type StepContext,
} from "../../context";
import { commitVisit } from "../../position";
import { gateNode, route } from "../../route";
import type { PendingGate, PendingParked } from "../../state";
import { beginStep, resumePromptOf, scoreGate, sessionOf } from "../../step";

import { answerRetryGate } from "../decide";

/**
 * An Agent that asks a person (`ask: "person"`). When its agent reports
 * `needs-input`, the step does not end and no edge is taken: the step
 * runner opens a Gate on the open step (`BodyResult` `ask`, `openGate`)
 * with the agent's summary and final message as the question and two
 * choices, and jumps to this ask node (`ask__<id>`), which interrupts until
 * a person answers. The Gate is a Gate like a Decision's: the Needs-you
 * inbox, the push, the phone and a daemon restart treat it the same.
 *
 * - `answer` (it needs a note): the transcript gets `gate-resolved`, and
 *   the node goes on with `pending.answer` set to the note. The resume
 *   point reopens the step (`StepReopened` with the note as its prompt, so
 *   the Gate closes in the log) and the same harness session goes on with
 *   the note, whatever the node's `session` says: `session` is about later
 *   visits. The agent may ask again: a new Gate on the same step.
 * - `stop`: the step ends `fail` with the outputs the session gave and the
 *   person's note, and the run routes on `fail`.
 * - a reopen (a person resumed a run stopped while the Gate was open: the
 *   stop ended the step `stopped`): the node takes the step up as a parked
 *   one, and the session goes on with the resume's prompt
 *   (`RESUME_RULES.agent`). The agent asks again when it still needs input.
 * - a stop that ended the step before the Gate was checkpointed (`stale`):
 *   a resume takes the step up at the resume point, and goes on as above.
 */
export function agentAskNode(node: AgentNode, ctx: StepContext): NodeAction {
	return gateNode(node, ctx, {
		async answer(pending, answer, state, config) {
			// The person tier of a cascade (ADR 6): try again, or stop.
			if (pending.climb) {
				return answerRetryGate(ctx, node, pending, answer, state, config);
			}
			if (answer?.kind !== "gate") return resumeOnStep(ctx, node, pending);
			const begun = await beginStep(ctx, node, state, config, {
				kind: "continue",
				stepId: pending.stepId,
				quiet: true,
			});
			// A continued step never parks at entry; the branch is for the type.
			if (begun.kind === "parked") return begun.command;
			const step = begun.step;
			const note = answer.note?.trim() ?? "";
			step.record(null, {
				type: "gate-resolved",
				choice: answer.choice,
				note,
			});
			if (answer.choice !== ASK_ANSWER) {
				const end = await step.end(
					"fail",
					{ ...askOutputs(pending), outcome: "fail", note },
					null,
				);
				// After the end, so the StepEnded carries the answering Command.
				await scoreGate(ctx, step.stepId, answer);
				return route(ctx, state, node, end, config);
			}
			await scoreGate(ctx, step.stepId, answer);
			step.leaveOpen();
			const asked: PendingGate = {
				...pending,
				answer: note === "" ? DEFAULT_RESUME_PROMPT : note,
			};
			return new Command({ update: { pending: asked }, goto: node.id });
		},
	});
}

/** The choice that sends the note to the agent. */
const ASK_ANSWER = "answer";
/** The choice that ends the step `fail`. */
const ASK_STOP = "stop";

/** What a Gate of an Agent that asks offers a person. */
export const ASK_CHOICES: readonly GateChoice[] = [
	{
		name: ASK_ANSWER,
		description: "Send your note to the agent. It continues where it stopped.",
		color: "green",
		needsNote: true,
	},
	{
		name: ASK_STOP,
		description: "End this step as failed.",
		color: "red",
	},
];

/** The step's outputs so far, as the Gate keeps them. */
function askOutputs(pending: PendingGate): StepOutputs {
	return (pending.outputs ?? { visit: pending.visit }) as StepOutputs;
}

/**
 * A person resumed the run that a stop ended at the Gate: the node takes
 * the step up as a parked one, so its session goes on with the resume's
 * prompt.
 */
async function resumeOnStep(
	ctx: StepContext,
	node: AgentNode,
	pending: PendingGate,
): Promise<Command> {
	const runState = await ctx.log.state(ctx.run.id);
	const step = runState.steps.get(pending.stepId);
	const parked: PendingParked = {
		kind: "parked",
		stepId: pending.stepId,
		nodeId: node.id,
		visit: pending.visit,
		harnessSessionId: sessionOf(step),
		prompt: (step && resumePromptOf(runState, step)) ?? DEFAULT_RESUME_PROMPT,
		status: "stopped",
		reason: null,
	};
	return new Command({
		update: {
			nodes: { [node.id]: { ...askOutputs(pending), outcome: "stopped" } },
			...commitVisit(node, pending.visit),
			pending: parked,
		},
		goto: node.id,
	});
}
