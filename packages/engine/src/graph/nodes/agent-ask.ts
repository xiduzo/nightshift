import { Command } from "@langchain/langgraph";
import type { AgentNode } from "@nightshift/flows";
import type { GateChoice, StepOutputs } from "../../log";
import { deriveSteps } from "../../read";
import {
	DEFAULT_RESUME_PROMPT,
	type NodeAction,
	type StepContext,
} from "../context";
import { scoreGate } from "../gate";
import { interruptNode } from "../interrupt";
import { resumePromptOf, sessionOf } from "../resume-point";
import { parkCommand, route, type StepEnd } from "../route";
import { commitVisit } from "../run-position";
import type { PendingGate, PendingParked, RunStateUpdate } from "../state";
import { beginStep } from "../step-runner";

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
 *   the run parks as stopped on the step, and a resume goes on as above.
 */
export function agentAskNode(node: AgentNode, ctx: StepContext): NodeAction {
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
		}),
		async answer(pending, answer, state, config) {
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
		stale: { ctx, letGo: (pending) => parkOnStep(ctx, node, pending) },
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
		description: "Send your note to the agent. It goes on where it stopped.",
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
 * The Gate's step as a stop ended it in the log: the outputs the session
 * gave, and the harness session a resume goes on with.
 */
async function stoppedStep(
	ctx: StepContext,
	node: AgentNode,
	pending: PendingGate,
): Promise<{ end: StepEnd; update: RunStateUpdate; prompt: string | null }> {
	const events = await ctx.log.events(ctx.run.id);
	const step = deriveSteps(events).find((s) => s.id === pending.stepId);
	const outputs = { ...askOutputs(pending), outcome: "stopped" };
	return {
		end: {
			stepId: pending.stepId,
			visit: pending.visit,
			outcome: "stopped",
			outputs,
			error: null,
			harnessSessionId: sessionOf(step),
		},
		update: {
			nodes: { [node.id]: outputs },
			...commitVisit(node, pending.visit),
		},
		prompt: step ? resumePromptOf(events, step) : null,
	};
}

/** A stop ended the Gate's step before the Gate was checkpointed: the run parks as stopped on it. */
async function parkOnStep(
	ctx: StepContext,
	node: AgentNode,
	pending: PendingGate,
): Promise<Command> {
	const { end, update } = await stoppedStep(ctx, node, pending);
	return parkCommand({
		node,
		status: "stopped",
		reason: null,
		step: end,
		update,
	});
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
	const { end, update, prompt } = await stoppedStep(ctx, node, pending);
	const parked: PendingParked = {
		kind: "parked",
		stepId: end.stepId,
		nodeId: node.id,
		visit: end.visit,
		harnessSessionId: end.harnessSessionId ?? null,
		prompt: prompt ?? DEFAULT_RESUME_PROMPT,
		status: "stopped",
		reason: null,
	};
	return new Command({ update: { ...update, pending: parked }, goto: node.id });
}
