import type { DecisionInput, DecisionResult } from "@nightshift/agents/types";
import {
	type DecisionNode,
	optionProblem,
	renderTemplate,
} from "@nightshift/flows";

import type { Device } from "../../../device/types";
import {
	isWaitKind,
	messageOf,
	STOP_GRACE_MS,
	type StepContext,
} from "../../context";
import { RESUME_RULES } from "../../resume-point";
import { type BodyResult, runStep, type StepHandle } from "../../step-runner";
import { type Chooser, decisionOutputs, visibleOptions } from "../decision";

/**
 * A Decision decided by a model: the node's decider (a TanStack AI
 * decision model, `decide()`) reads the rendered prompt and picks an
 * option. The transcript gets `decision-start` (the prompt, the option
 * names, the model) and, on an answer, `decision`; `StepEnded` carries the
 * decider's cost as `costUsd`, also on an error or a stop. The decider's
 * reasons go in the `note` output.
 *
 * The step lifecycle is the step runner's (`runStep` with
 * `RESUME_RULES.model`): the step that waited for a usage limit or the
 * network continues (same step id and visit; nothing is appended before the
 * decider is asked again), or is reopened first when recovery ended it
 * after the wake. Otherwise a new visit: a parked or interrupted step has
 * no session to reopen. A usage limit or a network failure is a wait
 * request; the runner plans the wait and parks at the node's wait node
 * (`wait__<id>`), or ends the step `error` on a give-up. This module is
 * the body: `decide`.
 */
export function modelChooser(node: DecisionNode, ctx: StepContext): Chooser {
	return (state, config) =>
		runStep(ctx, node, state, config, {
			rules: RESUME_RULES.model,
			outputs: (step) => decisionOutputs("", "", step.visit),
			body: (step) => decide(node, step),
		});
}

/** Asks the decider and ends the step on its answer, or asks for a wait. */
async function decide(
	node: DecisionNode,
	step: StepHandle,
): Promise<BodyResult> {
	const { visit, signal } = step;
	const prompt = renderTemplate(node.prompt, step.tctx);
	const options = visibleOptions(node);
	const decider = step.device.capabilities().decider;
	if (!decider) {
		return {
			kind: "end",
			outcome: "error",
			outputs: decisionOutputs("error", "", visit),
			error: "No decider is configured for Decision nodes.",
		};
	}
	// The Device says which model a node without one starts on.
	const model = node.model ?? decider.defaultModels[node.decider].decision;
	step.record(null, {
		type: "decision-start",
		prompt,
		labels: options.map((option) => option.name),
		model,
	});
	const result = await decideWithin(
		step.device,
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
	const end = (outcome: string, error: string | null): BodyResult => ({
		kind: "end",
		outcome,
		outputs: decisionOutputs(outcome, note, visit),
		error,
		costUsd,
	});
	if (signal.aborted) {
		return {
			kind: "aborted",
			outputs: decisionOutputs("", note, visit),
			costUsd,
		};
	}
	if (result.kind === "error") {
		if (isWaitKind(result.errorKind)) {
			return {
				kind: "wait",
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
 * Asks the Device's decider, but never waits on it longer than
 * `STOP_GRACE_MS` past an abort: a decider that ignores its signal cannot
 * hold the run. A decider that throws (against its contract) counts as an
 * error. Shared with an Agent node's checker.
 */
export function decideWithin(
	device: Pick<Device, "decide">,
	input: DecisionInput,
	signal: AbortSignal,
): Promise<DecisionResult> {
	return withinGrace(
		() =>
			device.decide(input).catch(
				(error): DecisionResult => ({
					kind: "error",
					errorKind: "harness",
					message: messageOf(error),
					costUsd: null,
				}),
			),
		signal,
		() => ({
			kind: "error",
			errorKind: "aborted",
			message: "The decider did not stop when it was aborted.",
			costUsd: null,
		}),
	);
}

/**
 * Runs `ask` but settles with `late()` once `STOP_GRACE_MS` has passed
 * after an abort: a decider that ignores its signal cannot hold the run.
 * Shared by the Decision chooser and the Value producer.
 */
export async function withinGrace<T>(
	ask: () => Promise<T>,
	signal: AbortSignal,
	late: () => T,
): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	let onAbort: (() => void) | undefined;
	const expired = new Promise<T>((resolve) => {
		onAbort = () => {
			timer = setTimeout(() => resolve(late()), STOP_GRACE_MS);
		};
		if (signal.aborted) onAbort();
		else signal.addEventListener("abort", onAbort, { once: true });
	});
	try {
		return await Promise.race([ask(), expired]);
	} finally {
		clearTimeout(timer);
		if (onAbort) signal.removeEventListener("abort", onAbort);
	}
}
