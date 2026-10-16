/**
 * Decision nodes on TanStack AI's `decide()`: one `choice` question whose
 * options are the node's labels, answered by a decision model. The deciders
 * are TanStack's own adapters; this module only picks one and fills in its
 * API key.
 */
import { type AnyEvaluateAdapter, choice, decide } from "@tanstack/ai";
import { OLLAYA_EVALUATE_MODELS, ollayaDecider } from "@tanstack/ai-ollaya";
import {
	createOpenaiDecider,
	OPENAI_EVALUATE_MODELS,
} from "@tanstack/ai-openai";
import {
	createOpenRouterDecider,
	OPENROUTER_EVALUATE_MODELS,
} from "@tanstack/ai-openrouter";
import {
	createTypesafeDecider,
	TYPESAFE_EVALUATE_MODELS,
} from "@tanstack/ai-typesafe";
import { failureKind } from "./translate";
import type {
	AgentErrorKind,
	Decider,
	DeciderName,
	DecisionInput,
	DecisionResult,
} from "./types";

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
	},
	openai: {
		label: "OpenAI Decisions",
		pkg: "@tanstack/ai-openai",
		models: OPENAI_EVALUATE_MODELS,
		defaultModel: "gpt-6-luna",
		apiKey: "OPENAI_API_KEY",
		create: (model, key) => createOpenaiDecider(model, key ?? ""),
	},
	ollaya: {
		label: "Ollaya on this computer",
		pkg: "@tanstack/ai-ollaya",
		models: OLLAYA_EVALUATE_MODELS,
		defaultModel: "laya:latest",
		apiKey: null,
		create: (model) => ollayaDecider(model),
	},
};

export type TanstackDeciderOptions = {
	/** A secret's value: the keychain, then the environment. */
	secret: (name: string) => Promise<string | undefined>;
};

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
		// The deciders report tokens, not money.
		costUsd: null,
	};
}

/** Decision nodes on `decide()`. Never throws. */
export function tanstackDecider(options: TanstackDeciderOptions): Decider {
	return {
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
	};
}
