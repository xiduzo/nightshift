/**
 * A server at a Model Profile's address (ADR 5): the models it lists, and
 * an OpenAI-compatible chat model on it. OpenJev, LM Studio, llama-server,
 * mlx-lm and vLLM all list their models at `GET /v1/models`: OpenAI's shape
 * (`data[].id`), or Jev's shape (`models[].name`) for OpenJev.
 */

import type { AnyTextAdapter } from "@tanstack/ai";

/** How long a listing waits for the server before it gives up. */
const LISTING_TIMEOUT_MS = 3_000;

/** No server answers at the address. */
const NOT_ANSWERING =
	/unable to connect|fetch failed|ECONNREFUSED|ConnectionRefused|connection refused|ENOTFOUND|getaddrinfo|timed? ?out|abort/i;

/** Bearer authorization for the key, unless the headers already authorize. */
export function withBearer(
	headers: Record<string, string>,
	apiKey: string | undefined,
): Record<string, string> {
	const authorized = Object.keys(headers).some(
		(name) => name.toLowerCase() === "authorization",
	);
	return apiKey && !authorized
		? { ...headers, Authorization: `Bearer ${apiKey}` }
		: headers;
}

/** What a server at an address needs to be reached: its root, headers and key. */
export type AddressAccess = {
	/** The server, without a trailing `/v1`. */
	root: string;
	headers: Record<string, string>;
	apiKey: string | undefined;
};

/**
 * The ids of the models the server lists (`GET /v1/models`). Throws with a
 * message for the person when it does not answer, refuses the key, or
 * answers with something else.
 */
export async function addressModels(at: AddressAccess): Promise<string[]> {
	let response: Response;
	try {
		response = await fetch(`${at.root}/v1/models`, {
			headers: withBearer(at.headers, at.apiKey),
			signal: AbortSignal.timeout(LISTING_TIMEOUT_MS),
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(
			NOT_ANSWERING.test(message) ||
				(error instanceof Error && error.name === "TimeoutError")
				? `Nothing answers at ${at.root}. Start the server, or check the address.`
				: `${at.root} did not answer: ${message}`,
		);
	}
	if (response.status === 401 || response.status === 403) {
		throw new Error(
			`${at.root} refuses the API key. Check the secret of the address.`,
		);
	}
	if (!response.ok) {
		throw new Error(
			`${at.root} did not list its models (HTTP ${response.status}). Check the address.`,
		);
	}
	const body = (await response.json().catch(() => null)) as {
		data?: { id?: unknown }[];
		models?: { name?: unknown }[];
	} | null;
	if (Array.isArray(body?.data)) {
		return body.data.flatMap((model) =>
			typeof model.id === "string" ? [model.id] : [],
		);
	}
	if (Array.isArray(body?.models)) {
		return body.models.flatMap((model) =>
			typeof model.name === "string" ? [model.name] : [],
		);
	}
	throw new AddressError(
		"other",
		`${at.root} did not list its models. Check that the address is the server's.`,
	);
}

/** A chat model on an OpenAI-compatible server (`{root}/v1/chat/completions`). */
export async function compatibleChat(
	model: string,
	at: AddressAccess,
): Promise<AnyTextAdapter> {
	const { openaiCompatibleText } = await import(
		"@tanstack/ai-openai/compatible"
	);
	return openaiCompatibleText(model, {
		name: "compatible",
		baseURL: `${at.root}/v1`,
		// The SDK wants a key: a server without one gets a placeholder.
		apiKey: at.apiKey ?? "none",
		defaultHeaders: at.headers,
	});
}
