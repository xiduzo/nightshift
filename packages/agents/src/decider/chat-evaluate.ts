/**
 * A chat model as a decision model. `decide()` takes an evaluate adapter,
 * and Ollama and OpenAI-compatible servers ship a text adapter only.
 * `@tanstack/ai` has no helper that turns one into the other. So
 * `ChatEvaluateAdapter` asks each choice question as one `chat()` call
 * held to a JSON Schema whose one field is an enum of the option keys: the
 * server constrains the answer to the options, and TanStack parses it. A
 * chat model reports no probabilities, so the answer carries none it did
 * not measure (see `probabilities`).
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
 * An evaluate adapter on a chat model. Choice questions only: Night Shift
 * asks nothing else, and a score or yes/no answer would need probabilities
 * a chat model does not give.
 */
export class ChatEvaluateAdapter extends BaseEvaluateAdapter<string> {
	readonly name: string;
	/** What the server is called in a failure: "Ollama". */
	private readonly label: string;
	private readonly text: (
		model: string,
	) => AnyTextAdapter | Promise<AnyTextAdapter>;

	constructor(
		model: string,
		name: string,
		label: string,
		text: (model: string) => AnyTextAdapter | Promise<AnyTextAdapter>,
	) {
		super({}, model);
		this.name = name;
		this.label = label;
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
					`${this.label} answers choice questions only, not ${question.type}.`,
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
					adapter: await this.text(model),
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
