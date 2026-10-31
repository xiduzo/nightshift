/**
 * Decision nodes on TanStack AI's `decide()`: one `choice` question whose
 * options are the node's labels, answered by a decision model. Value nodes
 * made by a model on `chat()` with an output schema, on the same decider's
 * text adapter. The deciders are TanStack's own adapters, and Ollama's text
 * adapter behind a small evaluate adapter (`./ollama`); this module only
 * picks one and fills in its API key. A provider's package loads on its
 * first call, not when Night Shift starts: the model lists here are copies.
 */

import {
	addressRoot,
	canMakeValue,
	deciderAddress,
	type ModelAddress,
	valueDeciderNameSchema,
} from "@nightshift/flows";
import {
	type AnyEvaluateAdapter,
	type AnyTextAdapter,
	chat,
	choice,
	decide,
	type TokenUsage,
} from "@tanstack/ai";
import type { OLLAYA_EVALUATE_MODELS } from "@tanstack/ai-ollaya";
import type { OPENAI_EVALUATE_MODELS } from "@tanstack/ai-openai";
import type { OPENROUTER_EVALUATE_MODELS } from "@tanstack/ai-openrouter";
import type { TYPESAFE_EVALUATE_MODELS } from "@tanstack/ai-typesafe";
import type {
	AgentErrorKind,
	Decider,
	DeciderName,
	DecisionInput,
	DecisionResult,
	ValueInput,
	ValueResult,
} from "../port";
import { type SettledCost, settleCost } from "../pricing";
import { failureKind } from "../session";
import {
	type AddressAccess,
	addressModels,
	compatibleChat,
	withBearer,
} from "./address";
import { ChatEvaluateAdapter } from "./chat-evaluate";
import {
	OLLAMA_DEFAULT_MODEL,
	OLLAMA_MODELS,
	type OllamaAddress,
	ollamaChat,
	ollamaDecider,
	ollamaModels,
	ollamaProblem,
} from "./ollama";

/** What a decider may need from Night Shift beyond its API key: where Ollama is. */
export type DeciderContext = {
	/** Where Ollama is now. Absent: Ollama's own default address. */
	ollama?: () => OllamaAddress;
};

/** A Model Profile's address with its secrets read: what an adapter connects to. */
export type ReachedAddress = {
	/** The server, without a trailing `/v1` (`addressRoot`). */
	root: string;
	/** The address's headers, with their `${NAME}` secrets filled in. */
	headers: Record<string, string>;
};

/**
 * What an adapter connects with: the API key's value, and the address of
 * the node's Model Profile when it has one (ADR 5). With an address, the
 * key is the address's own: a decider's vendor key does not go to it.
 */
export type DeciderAccess = {
	apiKey: string | undefined;
	address: ReachedAddress | undefined;
};

/**
 * How a decider makes a value: its TanStack AI text adapter and the chat
 * model it starts on. Only deciders in `valueDeciderNameSchema` have one.
 * TypeSafe and Ollaya ship an evaluate adapter only (choice, score, yes/no
 * questions): they cannot answer with data. Ollama's chat model can.
 */
export type ValueAdapter = {
	defaultModel: string;
	/** The chat models the adapter knows, when it lists them. Any other id works too. */
	models?: readonly string[];
	create: (
		model: string,
		access: DeciderAccess,
		context: DeciderContext,
	) => AnyTextAdapter | Promise<AnyTextAdapter>;
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
	create: (
		model: string,
		access: DeciderAccess,
		context: DeciderContext,
	) => AnyEvaluateAdapter | Promise<AnyEvaluateAdapter>;
	/** Set when the decider can also make a value (a Value node made by a model). */
	value?: ValueAdapter;
	/**
	 * How its tokens are priced: the provider in the price list, or free for
	 * a model on this computer. Absent: the price list guesses from the model.
	 */
	pricing?: { providerId: string } | "free";
	/**
	 * False when the adapter reports a pick without a measured probability
	 * (a chat model): the decision notes then leave the percentage out.
	 */
	probability?: false;
	/**
	 * The models the provider has on hand right now (Ollama: the models
	 * pulled on this computer). Throws when the provider does not answer.
	 */
	listModels?: (context: DeciderContext) => Promise<string[]>;
	/**
	 * The models the server at a profile's address lists (ADR 5): its
	 * `/v1/models`, Ollama's tags. Throws when it does not answer.
	 */
	listAt?: (at: AddressAccess, context: DeciderContext) => Promise<string[]>;
	/**
	 * What a failure means for the person, and how to fix it. Undefined:
	 * the failure keeps its own message.
	 */
	explain?: (message: string, model: string) => string | undefined;
};

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

/** `${NAME}`: a secret, as a header value reads it. */
const SECRET_REFERENCE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/**
 * The key and the address an adapter connects with, or why it cannot: a
 * missing secret. With an address, its own key and headers, and no vendor
 * key (ADR 5); a vendor API without a key fails as before.
 */
async function accessFor(
	spec: DeciderAdapter,
	address: ModelAddress | undefined,
	name: DeciderName,
	secret: (name: string) => Promise<string | undefined>,
): Promise<DeciderAccess | { problem: string }> {
	if (address === undefined && deciderAddress(name) === "required") {
		return {
			problem: `${spec.label} needs an address. Pick a Model Profile with the address of its server.`,
		};
	}
	if (address === undefined || deciderAddress(name) === null) {
		const apiKey = spec.apiKey ? await secret(spec.apiKey) : undefined;
		if (spec.apiKey && !apiKey) {
			return {
				problem: `${spec.label} needs an API key. Add the secret ${spec.apiKey} on the Secrets page.`,
			};
		}
		return { apiKey, address: undefined };
	}
	const at = await reachAddress(address, secret);
	if ("problem" in at) return at;
	const { apiKey, ...reachedAt } = at;
	return { apiKey, address: reachedAt };
}

/**
 * A Model Profile's address with its secrets read: the API key's value and
 * the headers with `${NAME}` filled in, or which secret is missing. The
 * secrets are this Device's own (ADR 1).
 */
export async function reachAddress(
	address: ModelAddress,
	secret: (name: string) => Promise<string | undefined>,
): Promise<AddressAccess | { problem: string }> {
	const missing = (name: string) => ({
		problem: `The address ${address.baseUrl} needs the secret ${name}. Add it on the Secrets page.`,
	});
	const apiKey = address.apiKey ? await secret(address.apiKey) : undefined;
	if (address.apiKey && !apiKey) return missing(address.apiKey);
	const headers: Record<string, string> = {};
	for (const [header, value] of Object.entries(address.headers ?? {})) {
		let filled = value;
		for (const match of value.matchAll(SECRET_REFERENCE)) {
			const ref = match[1] as string;
			const found = await secret(ref);
			if (found === undefined) return missing(ref);
			filled = filled.replaceAll(match[0], found);
		}
		headers[header] = filled;
	}
	return { root: addressRoot(address), headers, apiKey };
}

/** OpenJev's decision models. Any other id its server serves works too. */
const OPENJEV_MODELS = ["openjev-latest", "laya-1.0", "verdict-1.4"] as const;

/** The address an adapter needs: a decider without a default has one by now (`accessFor`). */
function reached(access: DeciderAccess, label: string): AddressAccess {
	if (!access.address) throw new Error(`${label} needs an address.`);
	return { ...access.address, apiKey: access.apiKey };
}

/** Every TanStack AI decider adapter (the `evaluate` activity). */
export const DECIDER_ADAPTERS: Record<DeciderName, DeciderAdapter> = {
	typesafe: {
		label: "TypeSafe Jev",
		pkg: "@tanstack/ai-typesafe",
		models: TYPESAFE_MODELS,
		defaultModel: "jev-latest",
		apiKey: "TYPESAFE_API_KEY",
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

export type TanstackDeciderOptions = DeciderContext & {
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
	const access = await accessFor(
		spec,
		input.address,
		input.decider,
		options.secret,
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
		options.secret,
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
	const message = error instanceof Error ? error.message : String(error);
	const explained = spec.explain?.(message, model);
	if (explained) return { errorKind: "harness", message: explained };
	return { errorKind: failureKind(message) ?? "harness", message };
}

export type DeciderModels = {
	/** The models that decide: the provider's listing first, then the adapter's. */
	models: string[];
	/** The models that make a value, in the same order. Empty when it lists none. */
	valueModels: string[];
	/** How many models came from the provider's listing. */
	listed: number;
	/** Why the provider's listing did not answer. Null when it did, or has none. */
	problem: string | null;
};

/**
 * The models a decider offers: what the provider has on hand first (Ollama:
 * the models pulled on this computer), then the adapter's lists. Never
 * throws: a provider that does not answer leaves the adapter's lists.
 */
export async function deciderModels(
	name: DeciderName,
	context: DeciderContext = {},
	/** A profile's address, its secrets read (`reachAddress`): its server lists instead. */
	at?: AddressAccess,
): Promise<DeciderModels> {
	const spec = DECIDER_ADAPTERS[name];
	const merged = (listed: string[], known: readonly string[]) => [
		...listed,
		...known.filter((m) => !listed.includes(m)),
	];
	const result = (listed: string[], problem: string | null) => ({
		models: merged(listed, spec.models),
		valueModels: spec.value ? merged(listed, spec.value.models ?? []) : [],
		listed: listed.length,
		problem,
	});
	const list =
		at && spec.listAt
			? () => (spec.listAt as NonNullable<typeof spec.listAt>)(at, context)
			: spec.listModels
				? () =>
						(spec.listModels as NonNullable<typeof spec.listModels>)(context)
				: null;
	if (!list) return result([], null);
	try {
		return result([...new Set(await list())], null);
	} catch (error) {
		return result([], error instanceof Error ? error.message : String(error));
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
