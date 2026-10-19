import type { ValueResult } from "@nightshift/agents/types";
import { renderTemplate, type ValueNode } from "@nightshift/flows";

import { schemaProblem } from "../../../output-schema";
import { isWaitKind, messageOf, type StepContext } from "../../context";
import { RESUME_RULES } from "../../resume-point";
import { type BodyResult, runStep, type StepHandle } from "../../step-runner";
import { withinGrace } from "../choosers/model";
import {
	endWithoutValue,
	endWithValue,
	type Producer,
	valueOutputs,
} from "../value";

/**
 * A Value made by a model: the node's decider (`Decider.value`, TanStack
 * AI `chat()` with the output schema on the decider's text adapter) reads
 * the rendered prompt and answers with data. The transcript gets
 * `value-start` (the prompt, the model) and `value` (the data, or why there
 * is none); `StepEnded` carries the decider's cost as `costUsd`.
 *
 * The step lifecycle is the step runner's, with the rules of a Decision
 * decided by a model (`RESUME_RULES.model`): a step that waited continues,
 * one recovery ended after the wake is reopened, anything else is a new
 * visit. A usage limit or a network failure is a wait request; the runner
 * plans the wait and parks at the node's wait node (`wait__<id>`), or ends
 * the step `error` on a give-up. This module is the body: `make`.
 *
 * The model fails, or its data does not match the output schema → `fail`,
 * with why in `note`. No decider, or a decider that cannot make values, or
 * an output schema that is not a valid JSON Schema → `error`.
 */
export function modelProducer(node: ValueNode, ctx: StepContext): Producer {
	return (state, config) =>
		runStep(ctx, node, state, config, {
			rules: RESUME_RULES.model,
			outputs: (step) => valueOutputs("", null, "", step.visit),
			body: (step) => make(ctx, node, step),
		});
}

/** Asks the decider and ends the step on its answer, or asks for a wait. */
async function make(
	ctx: StepContext,
	node: ValueNode,
	step: StepHandle,
): Promise<BodyResult> {
	const { visit, signal } = step;
	const prompt = renderTemplate(node.prompt ?? "", step.tctx);
	const fail = (error: string): BodyResult => ({
		kind: "end",
		outcome: "error",
		outputs: valueOutputs("error", null, "", visit),
		error,
	});
	const decider = ctx.decider;
	if (!decider?.value) return fail("No decider is configured for Value nodes.");
	// The decider port says which text model a node without one starts on.
	const model = node.model ?? decider.defaultModel(node.decider, "value");
	step.record(null, {
		type: "value-start",
		by: "model",
		source: prompt,
		model,
	});
	const invalid = schemaProblem(node.output);
	if (invalid !== null) return fail(invalid);
	const ask = () =>
		decider.value?.({
			decider: node.decider,
			prompt,
			output: node.output,
			model,
			signal,
		}) ??
		Promise.resolve(lateResult("No decider is configured for Value nodes."));
	const result = await withinGrace(
		() =>
			ask().catch(
				(error): ValueResult => ({
					kind: "error",
					errorKind: "harness",
					message: messageOf(error),
					costUsd: null,
				}),
			),
		signal,
		() => lateResult("The decider did not stop when it was aborted."),
	);
	const costUsd = result.costUsd;
	if (signal.aborted) {
		return {
			kind: "aborted",
			outputs: valueOutputs("", null, "", visit),
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
		return endWithoutValue(step, `The model failed: ${result.message}`, {
			costUsd,
		});
	}
	return endWithValue(step, node, result.data, "", { costUsd });
}

function lateResult(message: string): ValueResult {
	return { kind: "error", errorKind: "aborted", message, costUsd: null };
}
