/**
 * Decision nodes on TanStack AI's `decide()`: one `choice` question whose
 * options are the node's labels, answered by a decision model. Value nodes
 * made by a model on `chat()` with an output schema, on the same decider's
 * text adapter. The deciders are TanStack's own adapters; this module only
 * picks one and fills in its API key.
 */

import { canMakeValue, valueDeciderNameSchema } from "@nightshift/flows";
import {
	type AnyEvaluateAdapter,
	type AnyTextAdapter,
	chat,
	choice,
	decide,
	type TokenUsage,
} from "@tanstack/ai";
import { OLLAYA_EVALUATE_MODELS, ollayaDecider } from "@tanstack/ai-ollaya";
import {
	createOpenaiChat,
	createOpenaiDecider,
	OPENAI_EVALUATE_MODELS,
} from "@tanstack/ai-openai";
import {
	createOpenRouterDecider,
	createOpenRouterText,
	OPENROUTER_EVALUATE_MODELS,
} from "@tanstack/ai-openrouter";
import {
	createTypesafeDecider,
	TYPESAFE_EVALUATE_MODELS,
} from "@tanstack/ai-typesafe";
import { type SettledCost, settleCost } from "./pricing";
import { failureKind } from "./translate";
import type {
	AgentErrorKind,
	Decider,
	DeciderName,
	DecisionInput,
	DecisionResult,
	ValueInput,
	ValueResult,
} from "./types";

/**
 * How a decider makes a value: its TanStack AI text adapter and the chat
 * model it starts on. Only deciders in `valueDeciderNameSchema` have one.
 * TypeSafe and Ollaya ship an evaluate adapter only (choice, score, yes/no
 * questions): they cannot answer with data.
 */
export type ValueAdapter = {
	defaultModel: string;
	create: (model: string, apiKey: string | undefined) => AnyTextAdapter;
};

export type DeciderAdapter = {
	label: string;
	/** The `@tanstack/ai-*` package. */
	pkg: string;
	/** The models the adapter knows. Any other id works too. */
	models: readonly string[];
	defaultModel: string;
	/** The secret that holds its API key. Null: it needs none. */
	apiKey: string | null;
	create: (model: string, apiKey: string | undefined) => AnyEvaluateAdapter;
	/** Set when the decider can also make a value (a Value node made by a model). */
	value?: ValueAdapter;
	/**
	 * How its tokens are priced: the provider in the price list, or free for
	 * a model on this computer. Absent: the price list guesses from the model.
	 */
	pricing?: { providerId: string } | "free";
};

/** Every TanStack AI decider adapter (the `evaluate` activity). */
export const DECIDER_ADAPTERS: Record<DeciderName, DeciderAdapter> = {
	typesafe: {
		label: "TypeSafe Jev",
		pkg: "@tanstack/ai-typesafe",
		models: TYPESAFE_EVALUATE_MODELS,
		defaultModel: "jev-latest",
		apiKey: "TYPESAFE_API_KEY",
		create: (model, key) => createTypesafeDecider(model, key ?? ""),
	},
	openrouter: {
		label: "Jev on OpenRouter",
		pkg: "@tanstack/ai-openrouter",
		models: OPENROUTER_EVALUATE_MODELS,
		defaultModel: "~typesafe/jev-latest",
		apiKey: "OPENROUTER_API_KEY",
		create: (model, key) => createOpenRouterDecider(model, key ?? ""),
		pricing: { providerId: "openrouter" },
		value: {
			defaultModel: "~openai/gpt-mini-latest",
			create: (model, key) =>
				createOpenRouterText(
					model as Parameters<typeof createOpenRouterText>[0],
					key ?? "",
				),
		},
	},
	openai: {
		label: "OpenAI Decisions",
		pkg: "@tanstack/ai-openai",
		models: OPENAI_EVALUATE_MODELS,
		defaultModel: "gpt-6-luna",
		apiKey: "OPENAI_API_KEY",
		create: (model, key) => createOpenaiDecider(model, key ?? ""),
		pricing: { providerId: "openai" },
		value: {
			defaultModel: "gpt-5-mini",
			create: (model, key) =>
				createOpenaiChat(
					model as Parameters<typeof createOpenaiChat>[0],
					key ?? "",
				),
		},
	},
	ollaya: {
		label: "Ollaya on this computer",
		pkg: "@tanstack/ai-ollaya",
		models: OLLAYA_EVALUATE_MODELS,
		defaultModel: "laya:latest",
		apiKey: null,
		create: (model) => ollayaDecider(model),
		pricing: "free",
	},
};

/** The flows package and this table must agree on who can make a value. */
for (const name of valueDeciderNameSchema.options) {
	if (DECIDER_ADAPTERS[name].value === undefined) {
		throw new Error(
			`The decider "${name}" is listed as making values but has no text adapter.`,
		);
	}
}

/** What a decider without a text adapter answers a Value node. */
export function cannotMakeValueMessage(name: DeciderName): string {
	const able = valueDeciderNameSchema.options
		.map((other) => DECIDER_ADAPTERS[other].label)
		.join(" or ");
	return `${DECIDER_ADAPTERS[name].label} cannot make a value. Choose ${able}.`;
}

/**
 * The model a decider starts a node on when the node names none, from the
 * registry: what `Decider.defaultModel` answers for the TanStack decider and
 * the fake alike, so both sit at the same seam with the same values.
 */
export function defaultDeciderModel(
	name: DeciderName,
	makes: "decision" | "value",
): string {
	const adapter = DECIDER_ADAPTERS[name];
	return makes === "value"
		? (adapter.value?.defaultModel ?? adapter.defaultModel)
		: adapter.defaultModel;
}

export type TanstackDeciderOptions = {
	/** A secret's value: the keychain, then the environment. */
	secret: (name: string) => Promise<string | undefined>;
};

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
	const key = spec.apiKey ? await options.secret(spec.apiKey) : undefined;
	if (spec.apiKey && !key) {
		return failed(
			"harness",
			`${spec.label} needs an API key. Add the secret ${spec.apiKey} on the Agents page.`,
		);
	}
	const result = await decide({
		adapter: spec.create(input.model ?? spec.defaultModel, key),
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
	const percent = Math.round(result.label.probability * 100);
	return {
		kind: "decided",
		label: result.label.value,
		notes: `${spec.label} picked it with ${percent}% probability.`,
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
	const key = spec.apiKey ? await options.secret(spec.apiKey) : undefined;
	if (spec.apiKey && !key) {
		return valueFailed(
			"harness",
			`${spec.label} needs an API key. Add the secret ${spec.apiKey} on the Agents page.`,
		);
	}
	const abortController = new AbortController();
	const onAbort = () => abortController.abort();
	input.signal.addEventListener("abort", onAbort, { once: true });
	const model = input.model ?? maker.defaultModel;
	let usage: TokenUsage | undefined;
	try {
		const data: unknown = await chat({
			adapter: maker.create(model, key),
			messages: [{ role: "user", content: input.prompt }],
			outputSchema: input.output as Parameters<typeof chat>[0]["outputSchema"],
			stream: false,
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

/** Decision nodes on `decide()`, Value nodes on `chat()`. Never throws. */
export function tanstackDecider(options: TanstackDeciderOptions): Decider {
	return {
		defaultModel: defaultDeciderModel,
		decide: async (input) => {
			if (input.signal.aborted) {
				return failed("aborted", "The decision was aborted");
			}
			try {
				return await decideOnce(input, options);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				if (input.signal.aborted) {
					return failed("aborted", "The decision was aborted");
				}
				// `usage-limit` and `network` make the engine wait and ask again.
				return failed(failureKind(message) ?? "harness", message);
			}
		},
		value: async (input) => {
			if (input.signal.aborted) {
				return valueFailed("aborted", "The value was aborted");
			}
			try {
				return await valueOnce(input, options);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				if (input.signal.aborted) {
					return valueFailed("aborted", "The value was aborted");
				}
				return valueFailed(failureKind(message) ?? "harness", message);
			}
		},
	};
}
