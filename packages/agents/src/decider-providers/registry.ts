/**
 * The decider registry: one record per decider, every TanStack AI decider
 * adapter. A provider's package loads on its first call, not when Night
 * Shift starts: the model lists here are copies.
 */

import { valueDeciderNameSchema } from "@nightshift/flows";
import type { OLLAYA_EVALUATE_MODELS } from "@tanstack/ai-ollaya";
import type { OPENAI_EVALUATE_MODELS } from "@tanstack/ai-openai";
import type { OPENROUTER_EVALUATE_MODELS } from "@tanstack/ai-openrouter";
import type { TYPESAFE_EVALUATE_MODELS } from "@tanstack/ai-typesafe";
import type { DeciderName } from "../port";
import {
	type AddressAccess,
	addressModels,
	compatibleChat,
	withBearer,
} from "./address";
import { ChatEvaluateAdapter } from "./chat-evaluate";
import type {
	DeciderAccess,
	DeciderAdapter,
	DeciderContext,
} from "./decider-record";
import {
	LOCAL_DECIDER_MODEL,
	OLLAMA_DEFAULT_MODEL,
	OLLAMA_MODELS,
	type OllamaAddress,
	ollamaChat,
	ollamaDecider,
	ollamaModels,
	ollamaProblem,
} from "./ollama";

/*
 * The decision models each package knows. Copies, so the registry does not
 * load the packages: the types fail when a package's list changes.
 */
const TYPESAFE_MODELS = [
	"jev-latest",
	"jev-1.13.0",
] as const satisfies typeof TYPESAFE_EVALUATE_MODELS;
const OPENROUTER_MODELS = [
	"~typesafe/jev-latest",
	"typesafe/jev-1.13",
	"typesafe/jev-1.13.0",
] as const satisfies typeof OPENROUTER_EVALUATE_MODELS;
const OPENAI_MODELS = [
	"gpt-6-luna",
] as const satisfies typeof OPENAI_EVALUATE_MODELS;
const OLLAYA_MODELS = [
	"laya:latest",
	"laya:en",
	"laya:multilingual",
] as const satisfies typeof OLLAYA_EVALUATE_MODELS;

/**
 * The key and options of an OpenAI client: the vendor's API, or the
 * profile's address (an OpenJev `/v1/decisions`, for example). The SDK
 * wants a key, so an address without one gets a placeholder.
 */
function openaiClient(
	access: DeciderAccess,
): [string, { baseURL: string; defaultHeaders: Record<string, string> }?] {
	const { address, apiKey } = access;
	if (!address) return [apiKey ?? ""];
	return [
		apiKey ?? "none",
		{ baseURL: `${address.root}/v1`, defaultHeaders: address.headers },
	];
}

/** The profile's Ollama, else the Device's (`ollamaAddress`), else Ollama's default. */
function ollamaAt(
	access: DeciderAccess,
	context: DeciderContext,
): OllamaAddress | undefined {
	const { address, apiKey } = access;
	if (!address) return context.ollama?.();
	return { host: address.root, headers: withBearer(address.headers, apiKey) };
}

/** OpenJev's decision models. Any other id its server serves works too. */
const OPENJEV_MODELS = ["openjev-latest", "laya-1.0", "verdict-1.4"] as const;

/** The address an adapter needs: a decider without a default has one by now (`accessFor`). */
function reached(access: DeciderAccess, label: string): AddressAccess {
	if (!access.address) throw new Error(`${label} needs an address.`);
	return { ...access.address, apiKey: access.apiKey };
}

/** The secret that holds the TypeSafe Jev key: the guided setup saves it there. */
export const TYPESAFE_API_KEY = "TYPESAFE_API_KEY";

/**
 * What the guided setup of a decider needs (Q22): the secret of the
 * TypeSafe Jev key, and the model a decider on this computer downloads.
 */
export const DECIDER_SETUP = {
	typesafeKey: TYPESAFE_API_KEY,
	localModel: LOCAL_DECIDER_MODEL,
} as const;

/** Every TanStack AI decider adapter (the `evaluate` activity). */
export const DECIDER_ADAPTERS: Record<DeciderName, DeciderAdapter> = {
	typesafe: {
		label: "TypeSafe Jev",
		pkg: "@tanstack/ai-typesafe",
		models: TYPESAFE_MODELS,
		defaultModel: "jev-latest",
		apiKey: TYPESAFE_API_KEY,
		create: async (model, { apiKey }) => {
			const { createTypesafeDecider } = await import("@tanstack/ai-typesafe");
			return createTypesafeDecider(model, apiKey ?? "");
		},
	},
	openrouter: {
		label: "Jev on OpenRouter",
		pkg: "@tanstack/ai-openrouter",
		models: OPENROUTER_MODELS,
		defaultModel: "~typesafe/jev-latest",
		apiKey: "OPENROUTER_API_KEY",
		create: async (model, { apiKey }) => {
			const { createOpenRouterDecider } = await import(
				"@tanstack/ai-openrouter"
			);
			return createOpenRouterDecider(model, apiKey ?? "");
		},
		pricing: { providerId: "openrouter" },
		value: {
			defaultModel: "~openai/gpt-mini-latest",
			create: async (model, { apiKey }) => {
				const { createOpenRouterText } = await import(
					"@tanstack/ai-openrouter"
				);
				return createOpenRouterText(
					model as Parameters<typeof createOpenRouterText>[0],
					apiKey ?? "",
				);
			},
		},
	},
	openai: {
		label: "OpenAI Decisions",
		pkg: "@tanstack/ai-openai",
		models: OPENAI_MODELS,
		defaultModel: "gpt-6-luna",
		apiKey: "OPENAI_API_KEY",
		create: async (model, access) => {
			const { createOpenaiDecider } = await import("@tanstack/ai-openai");
			return createOpenaiDecider(
				model as Parameters<typeof createOpenaiDecider>[0],
				...openaiClient(access),
			);
		},
		pricing: { providerId: "openai" },
		listAt: addressModels,
		value: {
			defaultModel: "gpt-5-mini",
			create: async (model, access) => {
				const { createOpenaiChat } = await import("@tanstack/ai-openai");
				return createOpenaiChat(
					model as Parameters<typeof createOpenaiChat>[0],
					...openaiClient(access),
				);
			},
		},
	},
	ollaya: {
		label: "Ollaya on this computer",
		pkg: "@tanstack/ai-ollaya",
		models: OLLAYA_MODELS,
		defaultModel: "laya:latest",
		apiKey: null,
		create: async (model) => {
			const { ollayaDecider } = await import("@tanstack/ai-ollaya");
			return ollayaDecider(model);
		},
		pricing: "free",
	},
	ollama: {
		label: "Ollama on this computer",
		pkg: "@tanstack/ai-ollama",
		models: OLLAMA_MODELS,
		defaultModel: OLLAMA_DEFAULT_MODEL,
		apiKey: null,
		create: (model, access, context) =>
			ollamaDecider(model, ollamaAt(access, context)),
		pricing: "free",
		probability: false,
		listModels: (context) => ollamaModels(context.ollama?.()),
		listAt: (at) =>
			ollamaModels({
				host: at.root,
				headers: withBearer(at.headers, at.apiKey),
			}),
		explain: ollamaProblem,
		value: {
			defaultModel: OLLAMA_DEFAULT_MODEL,
			models: OLLAMA_MODELS,
			create: (model, access, context) =>
				ollamaChat(model, ollamaAt(access, context)),
		},
	},
	openjev: {
		label: "OpenJev",
		pkg: "@tanstack/ai-typesafe",
		models: OPENJEV_MODELS,
		defaultModel: "openjev-latest",
		apiKey: null,
		// The Jev wire API at the profile's address: TypeSafe's own adapter.
		create: async (model, access) => {
			const { createTypesafeDecider } = await import("@tanstack/ai-typesafe");
			const at = reached(access, "OpenJev");
			return createTypesafeDecider(
				model as Parameters<typeof createTypesafeDecider>[0],
				at.apiKey ?? "",
				{ baseURL: at.root, headers: at.headers },
			);
		},
		pricing: "free",
		listAt: addressModels,
	},
	compatible: {
		label: "OpenAI-compatible server",
		pkg: "@tanstack/ai-openai",
		models: [],
		// Most servers answer with the model they run; name it on the profile.
		defaultModel: "default",
		apiKey: null,
		create: (model, access) => {
			const at = reached(access, "An OpenAI-compatible server");
			return new ChatEvaluateAdapter(
				model,
				"compatible",
				"An OpenAI-compatible server",
				(m) => compatibleChat(m, at),
			);
		},
		pricing: "free",
		probability: false,
		listAt: addressModels,
		value: {
			defaultModel: "default",
			create: (model, access) =>
				compatibleChat(model, reached(access, "An OpenAI-compatible server")),
		},
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
	const labels = valueDeciderNameSchema.options.map(
		(other) => DECIDER_ADAPTERS[other].label,
	);
	const able =
		labels.length > 1
			? `${labels.slice(0, -1).join(", ")} or ${labels.at(-1)}`
			: (labels[0] ?? "");
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
