import { describe, expect, test } from "bun:test";
import { CHECK_LIMITS, CHECK_PROMPT } from "../catalog";
import { inMemorySessions } from "../sessions/adapters/out/in-memory-sessions";
import { checkAgent } from "./check-agent";

const harness = {
	name: "codex" as const,
	label: "Codex",
	run: async function* () {},
	takeOverCommand: () => null,
};
const input = {
	harness,
	profile: { model: "m" },
	cwd: "/own",
	signal: new AbortController().signal,
};
const ask = (...events: Parameters<typeof inMemorySessions>[0]) =>
	checkAgent(inMemorySessions(events))(input);
const end = (text: string) =>
	({ type: "end", sessionId: "s", report: null, text }) as const;

describe("checkAgent", () => {
	test("any answer in text counts, within the limits of the check", async () => {
		const sessions = inMemorySessions([end("Ready.")]);
		expect(await checkAgent(sessions)(input)).toEqual({ answered: true });
		expect(sessions.sessions).toEqual([
			{ ...input, prompt: CHECK_PROMPT, limits: CHECK_LIMITS },
		]);
	});

	test("a session that ends without text did not answer", async () => {
		const none = {
			answered: false,
			why: "The agent stopped without an answer.",
		};
		expect(await ask(end("  "))).toEqual(none);
		expect(await ask()).toEqual(none);
	});

	test("a failure is a result with its words", async () => {
		expect(
			await ask(
				{ type: "text", delta: "read" },
				{ type: "error", message: "Signed out.", sessionId: null },
			),
		).toEqual({ answered: false, why: "Signed out." });
	});

	test("an answer that came before a limit is still an answer", async () => {
		const limit = {
			type: "error",
			code: "limit",
			message: "Any words.",
			sessionId: "s",
		} as const;
		expect(await ask({ type: "text", delta: "ready" }, limit)).toEqual({
			answered: true,
		});
		expect(await ask(limit)).toEqual({ answered: false, why: "Any words." });
	});
});
