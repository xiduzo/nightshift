import { describe, expect, test } from "bun:test";
import { failingScript, fakeHarness, usageLimitScript } from "./fake";
import type { AgentEvent, AgentSessionInput } from "./types";

function input(overrides: Partial<AgentSessionInput> = {}): AgentSessionInput {
	return {
		cwd: "/tmp/fake",
		prompt: "Do the thing",
		model: "haiku",
		permissionMode: "default",
		signal: new AbortController().signal,
		...overrides,
	};
}

async function collect(
	stream: AsyncIterable<AgentEvent>,
): Promise<AgentEvent[]> {
	const events: AgentEvent[] = [];
	for await (const event of stream) events.push(event);
	return events;
}

function expectContract(events: AgentEvent[]) {
	expect(events[0]?.type).toBe("session");
	expect(events.filter((e) => e.type === "session")).toHaveLength(1);
	const terminals = events.filter(
		(e) => e.type === "finished" || e.type === "error",
	);
	expect(terminals).toHaveLength(1);
	expect(events.at(-1)).toBe(terminals[0] as AgentEvent);
}

describe("fakeHarness", () => {
	test("runs the default script", async () => {
		const harness = fakeHarness({ delayMs: 0 });
		const events = await collect(harness.run(input()));
		expectContract(events);
		expect(events.map((e) => e.type)).toEqual([
			"session",
			"text",
			"text",
			"text",
			"text",
			"tool-start",
			"tool-end",
			"tool-result",
			"text",
			"finished",
		]);
		const text = events
			.flatMap((e) => (e.type === "text" ? [e.delta] : []))
			.join("");
		expect(text).toBe("Looking at the repository.Done.");
		expect(events.at(-1)).toEqual({
			type: "finished",
			usage: { inputTokens: 100, outputTokens: 20, costUsd: 0.001 },
		});
	});

	test("is deterministic", async () => {
		const first = await collect(fakeHarness({ delayMs: 0 }).run(input()));
		const second = await collect(fakeHarness({ delayMs: 0 }).run(input()));
		expect(first).toEqual(second);
	});

	test("new sessions get new ids and resume reuses the given id", async () => {
		const harness = fakeHarness({ delayMs: 0 });
		const [a] = await collect(harness.run(input()));
		const [b] = await collect(harness.run(input()));
		const [c] = await collect(
			harness.run(input({ resumeSessionId: "keep-me" })),
		);
		expect(a).toMatchObject({ type: "session", sessionId: "fake-session-1" });
		expect(b).toMatchObject({ type: "session", sessionId: "fake-session-2" });
		expect(c).toMatchObject({ type: "session", sessionId: "keep-me" });
		expect(harness.calls.map((call) => call.resumeSessionId)).toEqual([
			undefined,
			undefined,
			"keep-me",
		]);
	});

	test("an abort ends the session with an aborted error", async () => {
		const controller = new AbortController();
		const harness = fakeHarness({ steps: [{ type: "wait", ms: 10_000 }] });
		const started = Date.now();
		const events: AgentEvent[] = [];
		for await (const event of harness.run(
			input({ signal: controller.signal }),
		)) {
			events.push(event);
			if (event.type === "session") controller.abort();
		}
		expect(Date.now() - started).toBeLessThan(1_000);
		expectContract(events);
		expect(events.at(-1)).toEqual({
			type: "error",
			kind: "aborted",
			message: "The session was aborted",
		});
	});

	test("usage-limit script", async () => {
		const events = await collect(
			fakeHarness({ ...usageLimitScript(1_760_000_000_000), delayMs: 0 }).run(
				input(),
			),
		);
		expectContract(events);
		expect(events.at(-1)).toEqual({
			type: "error",
			kind: "usage-limit",
			message: "You've hit your limit",
			resetAt: 1_760_000_000_000,
		});
	});

	test("failing script", async () => {
		const events = await collect(
			fakeHarness({ ...failingScript("broken"), delayMs: 0 }).run(input()),
		);
		expectContract(events);
		expect(events.at(-1)).toEqual({
			type: "error",
			kind: "harness",
			message: "broken",
		});
	});

	test("a function picks the script per call", async () => {
		const harness = fakeHarness((_input, call) =>
			call === 0 ? { ...usageLimitScript(), delayMs: 0 } : { delayMs: 0 },
		);
		const first = await collect(harness.run(input()));
		const session = first[0];
		if (session?.type !== "session") throw new Error("expected a session");
		const second = await collect(
			harness.run(
				input({ resumeSessionId: session.sessionId, prompt: "continue" }),
			),
		);
		expect(first.at(-1)).toMatchObject({ type: "error", kind: "usage-limit" });
		expect(second[0]).toMatchObject({ sessionId: session.sessionId });
		expect(second.at(-1)?.type).toBe("finished");
		expect(harness.calls[1]?.prompt).toBe("continue");
	});

	test("tool steps carry their input and result", async () => {
		const events = await collect(
			fakeHarness({
				delayMs: 0,
				steps: [
					{
						type: "tool",
						name: "Bash",
						input: { command: "ls" },
						result: "a.txt",
					},
				],
			}).run(input()),
		);
		expect(events.slice(1, 4)).toEqual([
			{ type: "tool-start", toolCallId: "fake-tool-1", name: "Bash" },
			{
				type: "tool-end",
				toolCallId: "fake-tool-1",
				name: "Bash",
				input: { command: "ls" },
			},
			{ type: "tool-result", toolCallId: "fake-tool-1", content: "a.txt" },
		]);
	});
});
