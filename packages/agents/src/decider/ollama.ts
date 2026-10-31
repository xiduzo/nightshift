/**
 * Ollama on this computer, as a decider: Decision nodes and Value nodes on
 * any chat model the person has pulled.
 *
 * `@tanstack/ai-ollama` ships a text adapter only, and `decide()` takes an
 * evaluate adapter. `@tanstack/ai` has no helper that turns one into the
 * other, and Ollama's own `/v1/systemone` answers only its llama.cpp
 * decision models, not a chat model. So `OllamaEvaluateAdapter` asks each
 * choice question as one `chat()` call held to a JSON Schema whose one
 * field is an enum of the option keys: Ollama constrains the answer to the
 * options, and TanStack parses it. A chat model reports no probabilities,
 * so the answer carries none it did not measure (see `probabilities`).
 *
 * Where Ollama is, and the headers it needs, is the engine's to decide
 * (one resolver for Decision nodes and search by meaning): the daemon
 * passes it in as an `OllamaAddress`. Without one, Ollama's own default.
 */

import {
	type AnyTextAdapter,
	BaseEvaluateAdapter,
	buildBaseUsage,
	chat,
	type TokenUsage,
} from "@tanstack/ai";
import type {
	EvaluateAdapterResult,
	EvaluateOptions,
	WireAnswer,
	WireChoiceQuestion,
} from "@tanstack/ai/adapters";
import { createOllamaChat, OllamaTextModels } from "@tanstack/ai-ollama";
import { Ollama } from "ollama";

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

const SYSTEM_PROMPT =
	"You make one decision. Read the request, then pick the one option that answers the question. Answer with the option's key only.";

function asText(value: unknown): string {
	return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function choicePrompt(state: unknown, question: WireChoiceQuestion): string {
	const options = Object.entries(question.criteria)
		.map(([key, about]) => (about ? `- ${key}: ${about}` : `- ${key}`))
		.join("\n");
	return [
		`Request:\n${asText(state)}`,
		`Question:\n${asText(question.instructions)}`,
		`Options:\n${options}`,
		'Answer as JSON: {"choice": "<option key>"}',
	].join("\n\n");
}

/**
 * An evaluate adapter on Ollama's chat. Choice questions only: Night Shift
 * asks nothing else, and a score or yes/no answer would need probabilities
 * a chat model does not give.
 */
export class OllamaEvaluateAdapter extends BaseEvaluateAdapter<string> {
	readonly name = "ollama";
	private readonly text: (model: string) => AnyTextAdapter;

	constructor(
		model: string,
		text: (model: string) => AnyTextAdapter = (m) => ollamaChat(m),
	) {
		super({}, model);
		this.text = text;
	}

	async evaluate(options: EvaluateOptions): Promise<EvaluateAdapterResult> {
		const { model, state, questions, abortSignal, logger } = options;
		const answers: Record<string, WireAnswer> = {};
		let promptTokens = 0;
		let completionTokens = 0;
		for (const [id, question] of Object.entries(questions)) {
			if (question.type !== "choice") {
				throw new Error(
					`Ollama answers choice questions only, not ${question.type}.`,
				);
			}
			const keys = Object.keys(question.criteria);
			const abortController = new AbortController();
			const onAbort = () => abortController.abort();
			abortSignal?.addEventListener("abort", onAbort, { once: true });
			logger.request(`activity=evaluate provider=${this.name} model=${model}`, {
				provider: this.name,
				model,
			});
			try {
				const data = (await chat({
					adapter: this.text(model),
					systemPrompts: [SYSTEM_PROMPT],
					messages: [{ role: "user", content: choicePrompt(state, question) }],
					outputSchema: {
						type: "object",
						properties: { choice: { type: "string", enum: keys } },
						required: ["choice"],
					},
					stream: false,
					debug: false,
					abortController,
					middleware: [
						{
							onUsage: (_, usage: TokenUsage) => {
								promptTokens += usage.promptTokens;
								completionTokens += usage.completionTokens;
							},
						},
					],
				})) as { choice?: unknown };
				const picked = data?.choice;
				if (typeof picked !== "string" || !keys.includes(picked)) {
					throw new Error(
						`The model answered ${JSON.stringify(data)}, which is not one of the options.`,
					);
				}
				answers[id] = {
					type: "choice",
					choice: picked,
					// Not measured: the pick is all a chat model reports.
					probabilities: { [picked]: 1 },
					confidence: 1,
				};
			} catch (error) {
				logger.errors(`${this.name}.evaluate fatal`, {
					error,
					source: `${this.name}.evaluate`,
				});
				throw error;
			} finally {
				abortSignal?.removeEventListener("abort", onAbort);
			}
		}
		return {
			model,
			answers,
			usage: buildBaseUsage({
				promptTokens,
				completionTokens,
				totalTokens: promptTokens + completionTokens,
			}),
		};
	}
}

/** Decides on an Ollama chat model, at `at` or Ollama's default address. */
export function ollamaDecider(
	model: string,
	at: OllamaAddress = OLLAMA_DEFAULT,
): OllamaEvaluateAdapter {
	return new OllamaEvaluateAdapter(model, (m) => ollamaChat(m, at));
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
