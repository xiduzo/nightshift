/**
 * Decision nodes on TanStack AI's `decide()`: one `choice` question whose
 * options are the node's labels, answered by a decision model. Value nodes
 * made by a model on `chat()` with an output schema, on the same decider's
 * text adapter. The deciders are TanStack's own adapters, and Ollama's text
 * adapter behind a small evaluate adapter (`./ollama`). This module only
 * picks one from the registry (`registry.ts`) and fills in what it
 * connects with (`access.ts`).
 */

import { randomUUID } from "node:crypto";
import { canMakeValue } from "@nightshift/flows";
import { messageOf } from "@nightshift/refusal";
import { chat, choice, decide, type TokenUsage } from "@tanstack/ai";
import type {
	AgentErrorKind,
	Decider,
	DecisionInput,
	DecisionResult,
	ValueInput,
	ValueResult,
} from "../port";
import { type SettledCost, settleCost } from "../pricing";
import { failureKind } from "../session";
import { accessFor, secretsOf, type TanstackDeciderOptions } from "./access";
import type { DeciderAdapter } from "./decider-record";
import { checkAddress } from "./models";
import {
	cannotMakeValueMessage,
	DECIDER_ADAPTERS,
	defaultDeciderModel,
} from "./registry";

/**
 * What one decider call cost: the provider's own figure (OpenRouter sends
 * one), else its tokens priced, else unknown. A model on this computer is
 * free.
 */
function costOf(
	spec: DeciderAdapter,
	model: string,
	usage: TokenUsage | undefined,
): SettledCost {
	if (spec.pricing === "free") return { costUsd: 0, costSource: "estimated" };
	if (!usage) return { costUsd: null, costSource: null };
	const settled = settleCost(
		{
			inputTokens: usage.promptTokens,
			outputTokens: usage.completionTokens,
			...(usage.promptTokensDetails?.cachedTokens !== undefined
				? { cacheReadTokens: usage.promptTokensDetails.cachedTokens }
				: {}),
			...(usage.promptTokensDetails?.cacheWriteTokens !== undefined
				? { cacheWriteTokens: usage.promptTokensDetails.cacheWriteTokens }
				: {}),
			...(usage.cost !== undefined ? { costUsd: usage.cost } : {}),
		},
		model,
		spec.pricing ? { providerId: spec.pricing.providerId } : {},
	);
	return settled;
}

function failed(errorKind: AgentErrorKind, message: string): DecisionResult {
	return { kind: "error", errorKind, message, costUsd: null };
}

async function decideOnce(
	input: DecisionInput,
	options: TanstackDeciderOptions,
): Promise<DecisionResult> {
	const spec = DECIDER_ADAPTERS[input.decider];
	const access = await accessFor(
		spec,
		input.address,
		input.decider,
		secretsOf(options, input.run),
	);
	if ("problem" in access) return failed("harness", access.problem);
	const result = await decide({
		adapter: await spec.create(
			input.model ?? spec.defaultModel,
			access,
			options,
		),
		state: input.prompt,
		questions: {
			label: choice({
				instructions: "Which option answers the request?",
				options: Object.fromEntries(
					input.labels.map((l) => [l.name, l.description?.trim() || null]),
				),
			}),
		},
		abortSignal: input.signal,
		debug: false,
	});
	const probability = result.label.probability;
	const percent = Math.round(probability * 100);
	return {
		kind: "decided",
		label: result.label.value,
		notes:
			spec.probability === false
				? `${spec.label} picked it.`
				: `${spec.label} picked it with ${percent}% probability.`,
		...(spec.probability === false ? {} : { probability }),
		...costOf(spec, result.meta.model, result.meta.usage),
	};
}

function valueFailed(errorKind: AgentErrorKind, message: string): ValueResult {
	return { kind: "error", errorKind, message, costUsd: null };
}

/**
 * One `chat()` call held to the node's output schema, no tools, no
 * streaming: TanStack asks the adapter's `structuredOutput` and parses the
 * answer. The engine checks the data against the schema itself.
 */
async function valueOnce(
	input: ValueInput,
	options: TanstackDeciderOptions,
): Promise<ValueResult> {
	const spec = DECIDER_ADAPTERS[input.decider];
	const maker = canMakeValue(input.decider) ? spec.value : undefined;
	if (!maker)
		return valueFailed("harness", cannotMakeValueMessage(input.decider));
	const access = await accessFor(
		spec,
		input.address,
		input.decider,
		secretsOf(options, input.run),
	);
	if ("problem" in access) return valueFailed("harness", access.problem);
	const abortController = new AbortController();
	const onAbort = () => abortController.abort();
	input.signal.addEventListener("abort", onAbort, { once: true });
	const model = input.model ?? maker.defaultModel;
	let usage: TokenUsage | undefined;
	try {
		const data: unknown = await chat({
			adapter: await maker.create(model, access, options),
			threadId: `nightshift-value-${randomUUID()}`,
			messages: [{ role: "user", content: input.prompt }],
			outputSchema: input.output as Parameters<typeof chat>[0]["outputSchema"],
			stream: false,
			debug: false,
			abortController,
			middleware: [
				{
					onUsage: (_, reported) => {
						usage = reported;
					},
				},
			],
		});
		return { kind: "made", data, ...costOf(spec, model, usage) };
	} finally {
		input.signal.removeEventListener("abort", onAbort);
	}
}

/**
 * Why a call failed, for the node: the decider's own explanation when it
 * has one (Ollama not running, a model not pulled), else the raw message.
 * `usage-limit` and `network` make the engine wait and ask again. An
 * explained failure is for the person to fix, so it fails the step.
 */
function failure(
	spec: DeciderAdapter,
	model: string,
	error: unknown,
): { errorKind: AgentErrorKind; message: string } {
	const message = messageOf(error);
	const explained = spec.explain?.(message, model);
	if (explained) return { errorKind: "harness", message: explained };
	return { errorKind: failureKind(message) ?? "harness", message };
}

/** Decision nodes on `decide()`, Value nodes on `chat()`. Never throws. */
export function tanstackDecider(options: TanstackDeciderOptions): Decider {
	return {
		defaultModel: defaultDeciderModel,
		checkAddress: ({ decider, address }) =>
			checkAddress(decider, address, options).catch(() => null),
		decide: async (input) => {
			if (input.signal.aborted) {
				return failed("aborted", "The decision was aborted");
			}
			try {
				return await decideOnce(input, options);
			} catch (error) {
				if (input.signal.aborted) {
					return failed("aborted", "The decision was aborted");
				}
				const spec = DECIDER_ADAPTERS[input.decider];
				const why = failure(spec, input.model ?? spec.defaultModel, error);
				return failed(why.errorKind, why.message);
			}
		},
		value: async (input) => {
			if (input.signal.aborted) {
				return valueFailed("aborted", "The value was aborted");
			}
			try {
				return await valueOnce(input, options);
			} catch (error) {
				if (input.signal.aborted) {
					return valueFailed("aborted", "The value was aborted");
				}
				const why = failure(
					DECIDER_ADAPTERS[input.decider],
					input.model ?? defaultDeciderModel(input.decider, "value"),
					error,
				);
				return valueFailed(why.errorKind, why.message);
			}
		},
	};
}
