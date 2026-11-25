import { describe, expect, test } from "bun:test";
import type {
	AgentEvent,
	AgentHarness,
	AgentSessionInput,
} from "../../../port";
import {
	type AssistantSessionEvent,
	AT_LIMIT,
	settleUsage,
} from "../domain/session";
import { type AssistantSessionInput, runSession } from "./run-session";

/** A harness that plays `events`, and keeps what it was asked. */
function harness(...events: AgentEvent[]) {
	const calls: AgentSessionInput[] = [];
	const it: AgentHarness = {
		name: "claude-code",
		label: "Claude Code",
		takeOverCommand: () => null,
		async *run(input) {
			calls.push(input);
			yield* events;
		},
	};
	return Object.assign(it, { calls });
}

const run = runSession({
	activityOf: (name) => (name === "quiet" ? null : `Does ${name}`),
	costOf: (usage, model) => usage.costUsd ?? (model === "m2" ? 7 : null),
});

async function ask(
	over: Pick<AssistantSessionInput, "harness"> & Partial<AssistantSessionInput>,
): Promise<AssistantSessionEvent[]> {
	const events: AssistantSessionEvent[] = [];
	for await (const event of run({
		profile: { model: "m" },
		cwd: "/repo",
		prompt: "Hi",
		signal: new AbortController().signal,
		...over,
	})) {
		events.push(event);
	}
	return events;
}

const session: AgentEvent = { type: "session", sessionId: "s-1", model: "m2" };
const text = (messageId: string, delta: string): AgentEvent => ({
	type: "text",
	messageId,
	delta,
});
const tool = (name: string): AgentEvent => ({
	type: "tool-end",
	toolCallId: name,
	name,
	input: {},
});
const usage = (inputTokens: number, outputTokens: number, costUsd: number) => ({
	inputTokens,
	outputTokens,
	costUsd,
});

describe("runSession", () => {
	test("asks the harness for a read-only session and nothing of the profile but its model", async () => {
		const it = harness({ type: "finished" });
		const signal = new AbortController().signal;
		await ask({
			harness: it,
			profile: { model: "m", effort: "low" },
			report: { output: { type: "object" } },
			resumeSessionId: "s-0",
			tools: [],
			limits: { turns: 3, usd: 0.5 },
			signal,
		});
		const { signal: _signal, ...call } = it.calls[0] ?? { signal };
		expect(call).toEqual({
			cwd: "/repo",
			prompt: "Hi",
			model: "m",
			effort: "low",
			permissionMode: "default",
			readOnly: true,
			resumeSessionId: "s-0",
			stepReport: { outcome: false, output: { type: "object" } },
			maxTurns: 3,
			maxBudgetUsd: 0.5,
		} as typeof call);
	});

	test("streams what the harness does, then one end", async () => {
		const events = await ask({
			harness: harness(
				session,
				text("1", "Look"),
				text("1", "ing."),
				tool("Read"),
				tool("Read"),
				tool("quiet"),
				{ ...text("9", "A subagent's."), parentToolCallId: "t" } as AgentEvent,
				text("2", "Done."),
				{ type: "report", outcome: "", summary: "Ok.", data: { a: 1 } },
				{ type: "finished", usage: usage(10, 2, 0.5) },
			),
		});
		expect(events).toEqual([
			{ type: "session", sessionId: "s-1" },
			{ type: "text", delta: "Look" },
			{ type: "text", delta: "ing." },
			// The same line twice in a row shows once.
			{ type: "activity", text: "Does Read" },
			// A new message starts a new paragraph. A subagent's text is no answer.
			{ type: "text", delta: "\n\nDone." },
			{ type: "usage", usage: usage(10, 2, 0.5) },
			{
				type: "end",
				sessionId: "s-1",
				report: { summary: "Ok.", data: { a: 1 } },
				text: "Looking.\n\nDone.",
			},
		]);
	});

	test("the end usage never counts less than the running total before it", async () => {
		const events = await ask({
			harness: harness(
				{ type: "usage", usage: usage(900, 90, 0.035) },
				// Only the last model call.
				{ type: "finished", usage: usage(200, 20, 0.007) },
			),
		});
		expect(events.filter((e) => e.type === "usage").at(-1)).toEqual({
			type: "usage",
			usage: usage(900, 90, 0.035),
		});
	});

	test("a usage without a cost is priced by the model the harness names", async () => {
		const events = await ask({
			harness: harness(session, {
				type: "usage",
				usage: { inputTokens: 1, outputTokens: 1 },
			}),
		});
		expect(events[1]).toMatchObject({ usage: { costUsd: 7 } });
	});

	test("an end usage that covers the running total wins with its reported cost", () => {
		const live = usage(900, 90, 0.035);
		const end = usage(900, 95, 0.007);
		expect(settleUsage(live, end)).toEqual(end);
		expect(settleUsage(null, end)).toEqual(end);
		expect(settleUsage(live, { inputTokens: 100, outputTokens: 99 })).toEqual(
			usage(900, 99, 0.035),
		);
	});

	test("a failure ends with words for the person and the session to resume", async () => {
		const failed = async (error: Extract<AgentEvent, { type: "error" }>) =>
			(await ask({ harness: harness(session, error) })).at(-1);
		expect(
			await failed({ type: "error", kind: "usage-limit", message: "429" }),
		).toEqual({
			type: "error",
			message:
				"This agent reached its usage limit. Try again later, or choose another agent.",
			sessionId: "s-1",
		});
		expect(
			await failed({ type: "error", kind: "network", message: "ECONNRESET" }),
		).toMatchObject({
			message:
				"Night Shift could not reach the model. Check the internet connection, then try again.",
		});
		expect(
			await failed({ type: "error", kind: "harness", message: "  " }),
		).toMatchObject({ message: "The agent stopped with an error." });
	});

	test("a failure before the harness names a session keeps the one it resumed", async () => {
		const events = await ask({
			harness: harness({ type: "error", kind: "harness", message: "Gone." }),
			resumeSessionId: "s-0",
		});
		expect(events).toEqual([
			{ type: "error", message: "Gone.", sessionId: "s-0" },
		]);
	});

	test("a harness that throws, or stops early, ends with an error", async () => {
		const throws = harness();
		throws.run = async function* () {
			yield session;
			throw new Error("Broke.");
		};
		expect((await ask({ harness: throws })).at(-1)).toEqual({
			type: "error",
			message: "Broke.",
			sessionId: "s-1",
		});
		expect((await ask({ harness: harness(session) })).at(-1)).toEqual({
			type: "error",
			message: "The agent stopped without an answer.",
			sessionId: "s-1",
		});
	});

	test("a person who stops it reads Stopped", async () => {
		const stop = new AbortController();
		stop.abort();
		const events = await ask({
			harness: harness({ type: "error", kind: "harness", message: "SIGTERM" }),
			signal: stop.signal,
		});
		expect(events.at(-1)).toMatchObject({ message: "Stopped." });
	});

	test("a person who stops a harness that throws reads Stopped, also with a limit", async () => {
		const stop = new AbortController();
		const throws = harness();
		throws.run = async function* (input) {
			yield session;
			yield text("1", "x");
			stop.abort();
			input.signal?.throwIfAborted();
			yield text("2", "y");
		};
		const events = await ask({
			harness: throws,
			limits: { turns: 5, usd: 5 },
			signal: stop.signal,
		});
		expect(events.at(-1)).toEqual({
			type: "error",
			message: "Stopped.",
			sessionId: "s-1",
		});
	});

	/** A harness that does not know limits: it ends when its signal fires. */
	const endless = (event: (turn: number) => AgentEvent) => {
		const it = harness();
		it.run = async function* (input) {
			for (let turn = 1; turn < 50; turn++) {
				if (input.signal?.aborted) {
					yield { type: "error", kind: "aborted", message: "Aborted" };
					return;
				}
				yield event(turn);
			}
		};
		return it;
	};

	test("stops a harness that goes over the turns or the money", async () => {
		const turns = await ask({
			harness: endless((turn) => text(`${turn}`, "x")),
			limits: { turns: 2 },
		});
		expect(turns.filter((e) => e.type === "text")).toHaveLength(3);
		expect(turns.at(-1)).toMatchObject({
			type: "error",
			code: "limit",
			message: AT_LIMIT,
		});
		const money = await ask({
			harness: endless((turn) => ({
				type: "usage",
				usage: usage(turn, turn, turn),
			})),
			limits: { usd: 2 },
		});
		expect(money.filter((e) => e.type === "usage")).toHaveLength(3);
		expect(money.at(-1)).toMatchObject({
			type: "error",
			code: "limit",
			message: AT_LIMIT,
		});
	});

	test("a harness that throws when the limit stops it ends at the limit", async () => {
		const it = harness();
		it.run = async function* (input) {
			for (let turn = 1; turn < 50; turn++) {
				input.signal?.throwIfAborted();
				yield text(`${turn}`, "x");
			}
		};
		const events = await ask({ harness: it, limits: { turns: 2 } });
		expect(events.at(-1)).toMatchObject({
			type: "error",
			code: "limit",
			message: AT_LIMIT,
		});
	});

	test("a harness that stopped at its limit: an error, unless it reported", async () => {
		const limit: AgentEvent = { type: "finished", limit: "budget" };
		expect((await ask({ harness: harness(limit) })).at(-1)).toEqual({
			type: "error",
			code: "limit",
			message: AT_LIMIT,
			sessionId: null,
		});
		expect(
			(
				await ask({
					harness: harness(
						{ type: "report", outcome: "", summary: "Ok." },
						limit,
					),
				})
			).at(-1),
		).toMatchObject({ type: "end", report: { summary: "Ok." } });
	});
});
