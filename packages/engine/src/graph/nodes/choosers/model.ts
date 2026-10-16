import { Command } from "@langchain/langgraph";
import { DECIDER_ADAPTERS } from "@nightshift/agents/decider";
import type {
	Decider,
	DecisionInput,
	DecisionResult,
} from "@nightshift/agents/types";
import {
	type DecisionNode,
	optionProblem,
	renderTemplate,
} from "@nightshift/flows";

import { deriveSteps, type LoggedEvent } from "../../../events";
import {
	beginStep,
	beginWait,
	isWaitKind,
	messageOf,
	STOP_GRACE_MS,
	type StepContext,
	type StepHandle,
	type StepStart,
	type WaitRequest,
} from "../../context";
import { type StepEnd, waitNodeId } from "../../route";
import type { RunStateValues } from "../../state";
import { type Chooser, decisionOutputs, visibleOptions } from "../decision";

/**
 * A Decision decided by a model: the node's decider (a TanStack AI
 * decision model, `decide()`) reads the rendered prompt and picks an
 * option. The transcript gets `decision-start` (the prompt, the option
 * names, the model) and, on an answer, `decision`; `StepEnded` carries the
 * decider's cost as `costUsd`, also on an error or a stop. The decider's
 * reasons go in the `note` output.
 *
 * How the step opens: with `pending.kind === "wait"` for this node, the
 * step that waited for a usage limit or the network continues (same step
 * id and visit; nothing is appended before the decider is asked again),
 * or is reopened first when recovery ended it after the wake. Otherwise a
 * new visit: a parked or interrupted step has no session to reopen.
 *
 * A usage limit or a network failure plans a wait (`beginWait`) and jumps
 * to the node's wait node (`wait__<id>`), which interrupts; a give-up ends
 * the step `error`.
 */
export function modelChooser(node: DecisionNode, ctx: StepContext): Chooser {
	return async (state, config) => {
		const begun = await beginStep(
			ctx,
			node,
			state,
			config,
			entryOf(node, state, await ctx.log.events(ctx.run.id)),
		);
		if (begun.kind === "parked") return begun.command;
		const step = begun.step;
		try {
			const decided = await decide(ctx, node, step);
			if (!("reason" in decided)) return decided;
			const waited = await beginWait(ctx, node, step, decided);
			if (waited.kind === "wait") {
				return new Command({
					update: {
						pending: waited.pending,
						visits: { [node.id]: step.visit },
					},
					goto: waitNodeId(node.id),
				});
			}
			return step.end(
				"error",
				decisionOutputs("error", "", step.visit),
				waited.error,
				{ costUsd: decided.costUsd },
			);
		} catch (error) {
			return step.end(
				"error",
				decisionOutputs("error", "", step.visit),
				messageOf(error),
			);
		}
	};
}

/**
 * The step continues after a wait, or is reopened (`StepReopened`) when
 * recovery ended it `interrupted` meanwhile (the daemon died after the
 * wake), so the log keeps one open step to end; anything else is a new
 * visit.
 */
function entryOf(
	node: DecisionNode,
	state: RunStateValues,
	events: readonly LoggedEvent[],
): StepStart {
	const pending = state.pending;
	if (pending?.kind === "wait" && pending.nodeId === node.id) {
		const own = deriveSteps(events).find((s) => s.id === pending.stepId);
		if (own && own.endedAt !== null) {
			return { kind: "reopen", stepId: own.id, prompt: null };
		}
		return { kind: "continue", stepId: pending.stepId };
	}
	return { kind: "new" };
}

/** A wait request that also carries what the decider cost before it hit the limit. */
type DecisionWait = WaitRequest & { costUsd: number | null };

/** Asks the decider and ends the step on its answer, or asks for a wait. */
async function decide(
	ctx: StepContext,
	node: DecisionNode,
	step: StepHandle,
): Promise<StepEnd | DecisionWait> {
	const { visit, signal } = step;
	const prompt = renderTemplate(node.prompt, step.tctx);
	const options = visibleOptions(node);
	const model = node.model ?? DECIDER_ADAPTERS[node.decider].defaultModel;
	step.record(null, {
		type: "decision-start",
		prompt,
		labels: options.map((option) => option.name),
		model,
	});
	if (!ctx.decider) {
		return step.end(
			"error",
			decisionOutputs("error", "", visit),
			"No decider is configured for Decision nodes.",
		);
	}
	const result = await decideWithin(
		ctx.decider,
		{ decider: node.decider, prompt, labels: options, model, signal },
		signal,
	);
	const costUsd = result.costUsd;
	if (result.kind === "decided") {
		step.record(null, {
			type: "decision",
			label: result.label,
			notes: result.notes,
		});
	}
	const note = result.kind === "decided" ? result.notes : "";
	const end = (outcome: StepEnd["outcome"], error: string | null) =>
		step.end(outcome, decisionOutputs(outcome, note, visit), error, {
			costUsd,
		});
	const aborted = step.abortResult(decisionOutputs("", note, visit));
	if (aborted) return end(aborted.outcome, aborted.error);
	if (result.kind === "error") {
		if (isWaitKind(result.errorKind)) {
			return {
				reason: result.errorKind,
				message: result.message,
				resetAt: null,
				harnessSessionId: null,
				costUsd,
			};
		}
		return end("error", `The decider failed: ${result.message}`);
	}
	const problem = optionProblem(node.options, result.label);
	if (problem !== null) return end("error", problem);
	return end(result.label, null);
}

/**
 * Asks the decider, but never waits on it longer than `STOP_GRACE_MS` past
 * an abort: a decider that ignores its signal cannot hold the run. A decider
 * that throws (against its contract) counts as an error.
 */
async function decideWithin(
	decider: Decider,
	input: DecisionInput,
	signal: AbortSignal,
): Promise<DecisionResult> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	let onAbort: (() => void) | undefined;
	const late = new Promise<DecisionResult>((resolve) => {
		onAbort = () => {
			timer = setTimeout(
				() =>
					resolve({
						kind: "error",
						errorKind: "aborted",
						message: "The decider did not stop when it was aborted.",
						costUsd: null,
					}),
				STOP_GRACE_MS,
			);
		};
		if (signal.aborted) onAbort();
		else signal.addEventListener("abort", onAbort, { once: true });
	});
	try {
		return await Promise.race([
			decider.decide(input).catch(
				(error): DecisionResult => ({
					kind: "error",
					errorKind: "harness",
					message: messageOf(error),
					costUsd: null,
				}),
			),
			late,
		]);
	} finally {
		clearTimeout(timer);
		if (onAbort) signal.removeEventListener("abort", onAbort);
	}
}
