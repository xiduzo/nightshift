import { describe, expect, test } from "bun:test";
import {
	failingScript,
	fakeDecider,
	fakeHarness,
	reportingScript,
	usageLimitScript,
} from "./fake";
import type { AgentEvent, AgentSessionInput, DecisionInput } from "./types";

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

	test.each(["pass", "fail", "needs-input"] as const)(
		"reporting script: %s",
		async (outcome) => {
			const events = await collect(
				fakeHarness({
					...reportingScript(outcome, "Summary."),
					delayMs: 0,
				}).run(input({ stepReport: true })),
			);
			expectContract(events);
			expect(events.slice(-2)).toEqual([
				{ type: "report", outcome, summary: "Summary." },
				{ type: "finished" },
			]);
		},
	);

	test("report steps keep their place among the other steps", async () => {
		const events = await collect(
			fakeHarness({
				delayMs: 0,
				steps: [
					{ type: "report", outcome: "fail", summary: "first" },
					{ type: "text", text: "more" },
					{ type: "report", outcome: "pass", summary: "second" },
				],
			}).run(input()),
		);
		expect(events.map((e) => e.type)).toEqual([
			"session",
			"report",
			"text",
			"report",
			"finished",
		]);
	});
});

function decisionInput(overrides: Partial<DecisionInput> = {}): DecisionInput {
	return {
		cwd: "/tmp/fake",
		prompt: "Continue?",
		labels: [{ name: "continue" }, { name: "stop" }],
		model: "haiku",
		signal: new AbortController().signal,
		...overrides,
	};
}

describe("fakeDecider", () => {
	test("returns the scripted results in order and records the calls", async () => {
		const decider = fakeDecider(
			[
				{ label: "continue" },
				{ label: "stop", notes: "Enough.", costUsd: null },
				{
					kind: "error",
					errorKind: "usage-limit",
					message: "limit",
					costUsd: null,
				},
			],
			{ delayMs: 0 },
		);
		expect(await decider.decide(decisionInput())).toEqual({
			kind: "decided",
			label: "continue",
			notes: "Fake decision: continue",
			costUsd: 0.0001,
		});
		expect(await decider.decide(decisionInput())).toEqual({
			kind: "decided",
			label: "stop",
			notes: "Enough.",
			costUsd: null,
		});
		expect(await decider.decide(decisionInput())).toMatchObject({
			kind: "error",
			errorKind: "usage-limit",
		});
		expect(await decider.decide(decisionInput())).toMatchObject({
			kind: "error",
			errorKind: "harness",
		});
		expect(decider.calls).toHaveLength(4);
	});

	test("refuses a scripted label that is not one of the labels", async () => {
		const decider = fakeDecider([{ label: "maybe" }], { delayMs: 0 });
		expect(await decider.decide(decisionInput())).toMatchObject({
			kind: "error",
			errorKind: "harness",
		});
	});

	test("a script function picks per call", async () => {
		const decider = fakeDecider((input, call) => ({
			label: input.labels[call % 2]?.name ?? "stop",
		}));
		expect(await decider.decide(decisionInput())).toMatchObject({
			label: "continue",
		});
		expect(await decider.decide(decisionInput())).toMatchObject({
			label: "stop",
		});
	});

	test("honours the signal", async () => {
		const decider = fakeDecider([{ label: "continue" }], { delayMs: 10_000 });
		const controller = new AbortController();
		const pending = decider.decide(
			decisionInput({ signal: controller.signal }),
		);
		controller.abort();
		expect(await pending).toEqual({
			kind: "error",
			errorKind: "aborted",
			message: "The decision was aborted",
			costUsd: null,
		});
		const aborted = new AbortController();
		aborted.abort();
		expect(
			await decider.decide(decisionInput({ signal: aborted.signal })),
		).toMatchObject({ errorKind: "aborted" });
	});
});
