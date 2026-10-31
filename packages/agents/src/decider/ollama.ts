/**
 * Ollama on this computer, as a decider: Decision nodes and Value nodes on
 * any chat model the person has pulled.
 *
 * `@tanstack/ai-ollama` ships a text adapter only, and Ollama's own
 * `/v1/systemone` answers only its llama.cpp decision models, not a chat
 * model. So a Decision asks the chat model (`ChatEvaluateAdapter`).
 *
 * Where Ollama is, and the headers it needs, is the engine's to decide
 * (one resolver for Decision nodes and search by meaning): the daemon
 * passes it in as an `OllamaAddress`. Without one, Ollama's own default.
 */

import type { AnyTextAdapter } from "@tanstack/ai";
import { createOllamaChat, OllamaTextModels } from "@tanstack/ai-ollama";
import { Ollama } from "ollama";
import { ChatEvaluateAdapter } from "./chat-evaluate";

/** Where Ollama is: its address, and the headers of a proxy in front of it. */
export type OllamaAddress = {
	host: string;
	headers?: Record<string, string>;
};

/** Ollama's own default address. */
const OLLAMA_DEFAULT: OllamaAddress = { host: "http://127.0.0.1:11434" };

/** An Ollama chat adapter for `model` at `at`. */
export function ollamaChat(
	model: string,
	at: OllamaAddress = OLLAMA_DEFAULT,
): AnyTextAdapter {
	return createOllamaChat(model, {
		host: at.host,
		...(at.headers && Object.keys(at.headers).length > 0
			? { headers: at.headers }
			: {}),
	});
}

/** The models `@tanstack/ai-ollama` knows. Any model the person pulled works too. */
export const OLLAMA_MODELS: readonly string[] = [...new Set(OllamaTextModels)];

/**
 * A small model from the adapter's list that follows a JSON Schema well.
 * The person picks the model they pulled; this is only the placeholder.
 */
export const OLLAMA_DEFAULT_MODEL = "llama3.2:latest";

/** Decides on an Ollama chat model, at `at` or Ollama's default address. */
export function ollamaDecider(
	model: string,
	at: OllamaAddress = OLLAMA_DEFAULT,
): ChatEvaluateAdapter {
	return new ChatEvaluateAdapter(model, "ollama", "Ollama", (m) =>
		ollamaChat(m, at),
	);
}

/** How long a model listing waits for Ollama before it gives up. */
const LISTING_TIMEOUT_MS = 2_000;

/**
 * The models pulled on this computer (`GET /api/tags`), by name. Throws when
 * Ollama does not answer, with a message for the person.
 */
export async function ollamaModels(
	at: OllamaAddress = OLLAMA_DEFAULT,
): Promise<string[]> {
	const client = new Ollama({
		host: at.host,
		...(at.headers ? { headers: at.headers } : {}),
		fetch: ((input: string | URL | Request, init?: RequestInit) =>
			fetch(input, {
				...init,
				signal: AbortSignal.timeout(LISTING_TIMEOUT_MS),
			})) as typeof fetch,
	});
	try {
		const { models } = await client.list();
		return models.map((m) => m.name);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(
			NOT_RUNNING.test(message) || /timed? ?out|abort/i.test(message)
				? `Ollama does not answer ${placeOf(at)}. Start Ollama to see the models you pulled.`
				: `Ollama did not list its models: ${message}`,
		);
	}
}

/** "on this computer", or "at" the host name of an Ollama elsewhere. */
function placeOf(at: OllamaAddress): string {
	try {
		const { hostname } = new URL(at.host);
		return /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/.test(hostname)
			? "on this computer"
			: `at ${hostname}`;
	} catch {
		return "on this computer";
	}
}

/** Ollama's answer for a model it does not have: `model "x" not found`. */
const MODEL_NOT_FOUND = /model ['"]?([^'"\s]+)['"]? not found/i;

/** No server answers at the host. */
const NOT_RUNNING =
	/unable to connect|fetch failed|ECONNREFUSED|ConnectionRefused|connection refused/i;

/**
 * What an Ollama failure means for the person, and how to fix it. Undefined
 * for any other failure: the caller keeps the raw message.
 */
export function ollamaProblem(
	message: string,
	model: string,
): string | undefined {
	const missing = MODEL_NOT_FOUND.exec(message);
	if (missing) {
		const name = missing[1] ?? model;
		return `The model ${name} is not on this computer. Run ollama pull ${name} in a terminal, then run the step again.`;
	}
	if (NOT_RUNNING.test(message)) {
		return "Ollama is not running on this computer. Start Ollama and run the step again.";
	}
	return undefined;
}
