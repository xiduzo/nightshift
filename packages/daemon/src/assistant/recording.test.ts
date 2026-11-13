import { describe, expect, test } from "bun:test";
import type { AnswerCost } from "@nightshift/engine";
import {
	type AssistantService,
	type ChatEvent,
	type ChatRequest,
	type ExplanationEvent,
	type SuggestionEvent,
	type SuggestionRequest,
	singleAgentFlow,
} from "@nightshift/flows";
import { recordingAssistant } from "./recording";

/*
 * The wrapper that keeps what each answer cost: one record per answer
 * that spent something, with the built-in agent that answered.
 */

const SCOPE = { spaceId: "space-a", personId: "ada" };
const NOW = 1_700_000_000_000;

const usage = (
	inputTokens: number,
	outputTokens: number,
	costUsd?: number,
): { type: "usage"; usage: AnswerUsage } => ({
	type: "usage",
	usage: {
		inputTokens,
		outputTokens,
		...(costUsd !== undefined ? { costUsd } : {}),
	},
});
type AnswerUsage = {
	inputTokens: number;
	outputTokens: number;
	costUsd?: number;
};

async function* streamOf<Event>(events: readonly Event[]) {
	for (const event of events) yield event;
}

/** A wrapped assistant whose streams give `events`, and the records it kept. */
function recording(
	events: {
		suggest?: SuggestionEvent[];
		chat?: (request: ChatRequest) => ChatEvent[];
		explain?: ExplanationEvent[];
	},
	options: { keep?: (cost: AnswerCost) => Promise<void> } = {},
) {
	const kept: AnswerCost[] = [];
	const service: AssistantService = {
		suggest: () => streamOf(events.suggest ?? []),
		chat: (request) => streamOf(events.chat?.(request) ?? []),
		explain: () => streamOf(events.explain ?? []),
		agents: () => [],
		check: async (id) => ({
			id,
			ok: true,
			ms: 0,
			answers: null,
			problem: null,
		}),
	};
	const assistant = recordingAssistant(service, {
		keep:
			options.keep ??
			(async (cost) => {
				kept.push(cost);
			}),
		projectOfRun: async (runId) => (runId === "run-1" ? "p-of-run" : null),
		now: () => NOW,
	});
	return { assistant, kept };
}

async function all<Event>(stream: AsyncIterable<Event>): Promise<Event[]> {
	const events: Event[] = [];
	for await (const event of stream) events.push(event);
	return events;
}

const signal = new AbortController().signal;

const flow = singleAgentFlow({
	prompt: "Do the work.",
	permissionMode: "default",
	profile: "sonnet",
});
const suggestion: SuggestionRequest = {
	projectId: "p1",
	flowName: "night",
	flow,
	kind: "description",
	instruction: "",
};
const message = (fields: Partial<ChatRequest> = {}): ChatRequest => ({
	projectId: "p1",
	flowName: "night",
	flow,
	message: "Make it better.",
	...fields,
});

describe("one record per answer", () => {
	test("a suggestion keeps its last usage: the total of the answer", async () => {
		const events: SuggestionEvent[] = [
			{ type: "activity", text: "Reads the flow" },
			usage(100, 10, 0.01),
			usage(250, 40, 0.03),
			{
				type: "suggestion",
				suggestion: { kind: "description", description: "x", note: "y" },
			},
			{ type: "done" },
		];
		const { assistant, kept } = recording({ suggest: events });

		expect(await all(assistant.suggest(suggestion, signal, SCOPE))).toEqual(
			events,
		);
		expect(kept).toEqual([
			{
				at: NOW,
				agent: "field-writer",
				entry: "field.suggest",
				projectId: "p1",
				spaceId: "space-a",
				personId: "ada",
				inputTokens: 250,
				outputTokens: 40,
				costUsd: 0.03,
			},
		]);
	});

	test("an explanation is the Explainer's, on the project of its run", async () => {
		const { assistant, kept } = recording({
			explain: [
				usage(900, 120, 0.2),
				{ type: "answer", answer: "The step ran out of time." },
				{ type: "done" },
			],
		});
		await all(assistant.explain("run-1", signal, SCOPE));
		await all(assistant.explain("run-gone", signal, SCOPE));
		expect(kept).toMatchObject([
			{ agent: "explainer", entry: "run.why", projectId: "p-of-run" },
			{ agent: "explainer", entry: "run.why", projectId: null },
		]);
	});

	test("a cost that is not known is kept as null, with its tokens", async () => {
		const { assistant, kept } = recording({
			suggest: [usage(100, 10), { type: "done" }],
		});
		await all(assistant.suggest(suggestion, signal, SCOPE));
		expect(kept).toMatchObject([
			{ inputTokens: 100, outputTokens: 10, costUsd: null },
		]);
	});

	test("an answer that failed after it spent something is kept", async () => {
		const { assistant, kept } = recording({
			explain: [usage(400, 0, 0.05), { type: "error", message: "No answer." }],
		});
		await all(assistant.explain("run-1", signal, SCOPE));
		expect(kept).toMatchObject([{ agent: "explainer", costUsd: 0.05 }]);
	});

	test("an answer with no usage, or with none spent, keeps nothing", async () => {
		const { assistant, kept } = recording({
			suggest: [{ type: "error", message: "No agent can answer." }],
			explain: [usage(0, 0), { type: "done" }],
		});
		await all(assistant.suggest(suggestion, signal, SCOPE));
		await all(assistant.explain("run-1", signal, SCOPE));
		expect(kept).toEqual([]);
	});

	test("a stream the caller stops keeps what it spent so far", async () => {
		const { assistant, kept } = recording({
			chat: () => [
				{ type: "thread", threadId: "t1" },
				usage(100, 10, 0.01),
				{ type: "text", delta: "Let me" },
				usage(500, 90, 0.07),
				{ type: "text", delta: " look." },
				{ type: "done" },
			],
		});
		for await (const event of assistant.chat(message(), signal, SCOPE)) {
			// The person stops the answer after its first text.
			if (event.type === "text") break;
		}
		expect(kept).toMatchObject([
			{ agent: "builder", inputTokens: 100, outputTokens: 10, costUsd: 0.01 },
		]);
	});

	test("a stream that throws keeps what it spent, and still throws", async () => {
		const { assistant, kept } = recording({});
		const broken: AssistantService = {
			...assistant,
			suggest: async function* () {
				yield usage(70, 5, 0.02);
				throw new Error("The agent stopped.");
			},
		};
		const wrapped = recordingAssistant(broken, {
			keep: async (cost) => {
				kept.push(cost);
			},
			projectOfRun: async () => null,
		});
		await expect(
			all(wrapped.suggest(suggestion, signal, SCOPE)),
		).rejects.toThrow("The agent stopped.");
		expect(kept).toMatchObject([{ agent: "field-writer", costUsd: 0.02 }]);
	});

	test("a record that cannot be kept does not break the answer", async () => {
		const events: SuggestionEvent[] = [usage(100, 10, 0.01), { type: "done" }];
		const { assistant } = recording(
			{ suggest: events },
			{
				keep: async () => {
					throw new Error("The database is busy.");
				},
			},
		);
		const warn = console.warn;
		console.warn = () => {};
		try {
			expect(await all(assistant.suggest(suggestion, signal, SCOPE))).toEqual(
				events,
			);
		} finally {
			console.warn = warn;
		}
	});

	test("it passes on who answers for each agent", () => {
		expect(recording({}).assistant.agents()).toEqual([]);
	});
});

describe("which agent a chat answered as", () => {
	/**
	 * An assistant that keeps its threads as the real one does: it continues
	 * the thread a request names while it knows it, else it starts a new one
	 * (`t1`, `t2`, ...). `forget` drops every thread.
	 */
	const chats = () => {
		const known = new Set<string>();
		let started = 0;
		const made = recording({
			chat: (request) => {
				const threadId =
					request.threadId !== undefined && known.has(request.threadId)
						? request.threadId
						: `t${++started}`;
				known.add(threadId);
				return [
					{ type: "thread", threadId },
					usage(100, 10, 1),
					{ type: "done" },
				];
			},
		});
		return { ...made, forget: () => known.clear() };
	};

	test("the chat of the flow editor is the Builder's, at flow.build", async () => {
		const { assistant, kept } = chats();
		await all(assistant.chat(message(), signal, SCOPE));
		await all(assistant.chat(message({ entry: "flow.build" }), signal, SCOPE));
		expect(kept).toMatchObject([
			{ agent: "builder", entry: "flow.build", projectId: "p1" },
			{ agent: "builder", entry: "flow.build" },
		]);
	});

	test("an improve entry is the Improver's, with its entry", async () => {
		const { assistant, kept } = chats();
		for (const entry of [
			"run.improve",
			"spend.saving",
			"flow.improve",
		] as const) {
			await all(assistant.chat(message({ entry }), signal, SCOPE));
		}
		expect(kept).toMatchObject([
			{ agent: "improver", entry: "run.improve" },
			{ agent: "improver", entry: "spend.saving" },
			{ agent: "improver", entry: "flow.improve" },
		]);
	});

	test("a chat about a run is the Improver's", async () => {
		const { assistant, kept } = chats();
		await all(assistant.chat(message({ runId: "run-1" }), signal, SCOPE));
		expect(kept).toMatchObject([{ agent: "improver", entry: null }]);
	});

	test("a chat that became the Improver's stays so for the rest of the thread", async () => {
		const { assistant, kept } = chats();
		await all(assistant.chat(message(), signal, SCOPE));
		await all(
			assistant.chat(
				message({ threadId: "t1", entry: "flow.improve" }),
				signal,
				SCOPE,
			),
		);
		await all(assistant.chat(message({ threadId: "t1" }), signal, SCOPE));
		await all(
			assistant.chat(
				message({ threadId: "t1", entry: "flow.build" }),
				signal,
				SCOPE,
			),
		);
		expect(kept.map(({ agent, entry }) => ({ agent, entry }))).toEqual([
			{ agent: "builder", entry: "flow.build" },
			{ agent: "improver", entry: "flow.improve" },
			{ agent: "improver", entry: null },
			{ agent: "improver", entry: "flow.build" },
		]);
	});

	test("a thread the assistant forgot starts again as the Builder's", async () => {
		const { assistant, kept, forget } = chats();
		await all(
			assistant.chat(message({ entry: "flow.improve" }), signal, SCOPE),
		);
		forget();
		// The assistant does not know "t1" any more: it answers on a new thread.
		await all(assistant.chat(message({ threadId: "t1" }), signal, SCOPE));
		expect(kept.map(({ agent }) => agent)).toEqual(["improver", "builder"]);
	});

	test("an answer refused before its thread keeps nothing", async () => {
		const { assistant, kept } = recording({
			chat: () => [{ type: "error", message: "No agent can chat." }],
		});
		await all(assistant.chat(message(), signal, SCOPE));
		expect(kept).toEqual([]);
	});
});
