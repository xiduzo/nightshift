/**
 * The shape of one record in the decider registry (`registry.ts`): how
 * Night Shift makes a decider's adapter, and what the adapter connects with.
 */

import type { AnyEvaluateAdapter, AnyTextAdapter } from "@tanstack/ai";
import type { AddressAccess } from "./address";
import type { OllamaAddress } from "./ollama";

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
