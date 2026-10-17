import { Command } from "@langchain/langgraph";
import { DECIDER_ADAPTERS } from "@nightshift/agents/decider";
import type { ValueResult } from "@nightshift/agents/types";
import { renderTemplate, type ValueNode } from "@nightshift/flows";

import { schemaProblem } from "../../../output-schema";
import {
	beginStep,
	beginWait,
	isWaitKind,
	messageOf,
	type StepContext,
	type StepHandle,
	type WaitRequest,
} from "../../context";
import { type StepEnd, waitNodeId } from "../../route";
import { entryOf, withinGrace } from "../choosers/model";
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
 * It opens its step as a Decision decided by a model does (`entryOf`): a
 * step that waited continues, one recovery ended after the wake is
 * reopened, anything else is a new visit. A usage limit or a network
 * failure plans a wait (`beginWait`) and jumps to the node's wait node
 * (`wait__<id>`); a give-up ends the step `error`.
 *
 * The model fails, or its data does not match the output schema → `fail`,
 * with why in `note`. No decider, or a decider that cannot make values, or
 * an output schema that is not a valid JSON Schema → `error`.
 */
export function modelProducer(node: ValueNode, ctx: StepContext): Producer {
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
			const made = await make(ctx, node, step);
			if (!("reason" in made)) return made;
			const waited = await beginWait(ctx, node, state, step, made);
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
				valueOutputs("error", null, "", step.visit),
				waited.error,
				{ costUsd: made.costUsd },
			);
		} catch (error) {
			return step.end(
				"error",
				valueOutputs("error", null, "", step.visit),
				messageOf(error),
			);
		}
	};
}

/** A wait request that also carries what the decider cost before it hit the limit. */
type ValueWait = WaitRequest & { costUsd: number | null };

/** Asks the decider and ends the step on its answer, or asks for a wait. */
async function make(
	ctx: StepContext,
	node: ValueNode,
	step: StepHandle,
): Promise<StepEnd | ValueWait> {
	const { visit, signal } = step;
	const prompt = renderTemplate(node.prompt ?? "", step.tctx);
	const adapter = DECIDER_ADAPTERS[node.decider];
	const model =
		node.model ?? adapter.value?.defaultModel ?? adapter.defaultModel;
	step.record(null, {
		type: "value-start",
		by: "model",
		source: prompt,
		model,
	});
	const fail = (error: string) =>
		step.end("error", valueOutputs("error", null, "", visit), error);
	const invalid = schemaProblem(node.output);
	if (invalid !== null) return fail(invalid);
	const decider = ctx.decider;
	if (!decider?.value) return fail("No decider is configured for Value nodes.");
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
	const aborted = step.abortResult(valueOutputs("", null, "", visit));
	if (aborted) {
		return step.end(aborted.outcome, aborted.outputs, aborted.error, {
			costUsd,
		});
	}
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
		return endWithoutValue(step, `The model failed: ${result.message}`, {
			costUsd,
		});
	}
	return endWithValue(step, node, result.data, "", { costUsd });
}

function lateResult(message: string): ValueResult {
	return { kind: "error", errorKind: "aborted", message, costUsd: null };
}
