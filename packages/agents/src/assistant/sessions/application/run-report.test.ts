import { describe, expect, test } from "bun:test";
import type { ValueResult } from "../../../port";
import { inMemorySessions } from "../adapters/out/in-memory-sessions";
import type { AssistantSessionEvent } from "../domain/session";
import { type AssistantVia, runReport } from "./run-report";

const signal = new AbortController().signal;
const OUTPUT = { type: "object" };

async function report(via: AssistantVia, over: { signal?: AbortSignal } = {}) {
	const sessions = inMemorySessions([
		{ type: "end", sessionId: "s-1", report: null, text: "From the agent." },
	]);
	const events: AssistantSessionEvent[] = [];
	for await (const event of runReport(sessions)(via, {
		prompt: "Why?",
		report: { output: OUTPUT },
		resumeSessionId: "s-0",
		signal,
		...over,
	})) {
		events.push(event);
	}
	return { events, sessions: sessions.sessions };
}

/** A model that gives one answer, and keeps what it was asked. */
function model(answer: () => ValueResult) {
	const asked: { prompt: string; output: Record<string, unknown> }[] = [];
	const via: AssistantVia = {
		kind: "model",
		ask: async ({ prompt, output }) => {
			asked.push({ prompt, output });
			return answer();
		},
	};
	return { via, asked };
}

describe("runReport", () => {
	test("an agent answers in a session of its own, within its limits", async () => {
		const harness = {
			name: "codex" as const,
			label: "Codex",
			run: async function* () {},
			takeOverCommand: () => null,
		};
		const { events, sessions } = await report({
			kind: "agent",
			harness,
			profile: { model: "m" },
			cwd: "/repo",
			limits: { turns: 10 },
		});
		expect(sessions).toEqual([
			{
				harness,
				profile: { model: "m" },
				cwd: "/repo",
				prompt: "Why?",
				report: { output: OUTPUT },
				resumeSessionId: "s-0",
				limits: { turns: 10 },
				signal,
			},
		]);
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({ text: "From the agent." });
	});

	test("a model gets the prompt, the note and the shape, and its report comes back with the cost", async () => {
		const { via, asked } = model(() => ({
			kind: "made",
			data: { summary: "S", data: { a: 1 } },
			costUsd: 0.002,
		}));
		const { events, sessions } = await report(via);
		expect(sessions).toEqual([]);
		expect(asked[0]?.prompt).toStartWith("Why?\n");
		expect(asked[0]?.prompt).toContain("You cannot read files or call tools.");
		expect(asked[0]?.output).toEqual({
			type: "object",
			properties: { summary: { type: "string" }, data: OUTPUT },
			required: ["summary", "data"],
			additionalProperties: false,
		});
		expect(events).toEqual([
			{ type: "activity", text: "Asks the model" },
			{
				type: "usage",
				usage: { inputTokens: 0, outputTokens: 0, costUsd: 0.002 },
			},
			{
				type: "end",
				sessionId: "",
				report: { summary: "S", data: { a: 1 } },
				text: "S",
			},
		]);
	});

	test("a model that fails says why and what it cost, and never throws", async () => {
		const failed = model(() => ({
			kind: "error",
			errorKind: "network",
			message: "ECONNRESET",
			costUsd: 0.1,
		}));
		expect((await report(failed.via)).events.slice(1)).toEqual([
			{
				type: "usage",
				usage: { inputTokens: 0, outputTokens: 0, costUsd: 0.1 },
			},
			{
				type: "error",
				message:
					"Night Shift could not reach the model. Check the internet connection, then try again.",
				sessionId: null,
			},
		]);
		const stop = new AbortController();
		stop.abort();
		expect(
			(await report(failed.via, { signal: stop.signal })).events.at(-1),
		).toMatchObject({ message: "Stopped." });
		const throws = model(() => {
			throw new Error("No key.");
		});
		expect((await report(throws.via)).events.at(-1)).toEqual({
			type: "error",
			message: "No key.",
			sessionId: null,
		});
	});
});
