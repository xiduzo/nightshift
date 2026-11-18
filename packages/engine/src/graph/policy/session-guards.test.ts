import { describe, expect, test } from "bun:test";
import type { AgentEvent } from "@nightshift/agents/types";
import { type GuardTrip, sessionGuards } from "./session-guards";

let ids = 0;
const text = (delta = "Thinking."): AgentEvent => ({
	type: "text",
	messageId: `m${++ids}`,
	delta,
});
/** One tool call with its result: start, end, result. */
const call = (name: string, input: unknown): AgentEvent[] => {
	const toolCallId = `t${++ids}`;
	return [
		{ type: "tool-start", toolCallId, name },
		{ type: "tool-end", toolCallId, name, input },
		{ type: "tool-result", toolCallId, content: "ok" },
	];
};

/** Feeds the events and returns every trip, with the index of the event that tripped. */
function trips(
	events: AgentEvent[],
	maxTurns: number | null = null,
): { at: number; trip: GuardTrip }[] {
	const guards = sessionGuards({ maxTurns });
	const out: { at: number; trip: GuardTrip }[] = [];
	events.forEach((event, at) => {
		const trip = guards.see(event);
		if (trip) out.push({ at, trip });
	});
	return out;
}

describe("the loop guard", () => {
	test("three identical tool calls in a row trip it, on the third", () => {
		const events = [
			...call("Bash", { command: "bun test" }),
			text("Again."),
			...call("Bash", { command: "bun test" }),
			...call("Bash", { command: "bun test" }),
		];
		expect(trips(events)).toEqual([
			{ at: 8, trip: { kind: "looping", tool: "Bash" } },
		]);
	});

	test("the same input with its keys in another order is the same call", () => {
		const events = [
			...call("Edit", { path: "a.ts", text: "x" }),
			...call("Edit", { text: "x", path: "a.ts" }),
			...call("Edit", { path: "a.ts", text: "x" }),
		];
		expect(trips(events).map((t) => t.trip.kind)).toEqual(["looping"]);
	});

	test("three different calls, or a different call between, do not", () => {
		expect(
			trips([
				...call("Bash", { command: "bun test" }),
				...call("Bash", { command: "bun run lint" }),
				...call("Read", { path: "a.ts" }),
			]),
		).toEqual([]);
		expect(
			trips([
				...call("Bash", { command: "bun test" }),
				...call("Bash", { command: "bun test" }),
				...call("Edit", { path: "a.ts" }),
				...call("Bash", { command: "bun test" }),
				...call("Bash", { command: "bun test" }),
			]),
		).toEqual([]);
	});

	test("the same tool with other input does not", () => {
		expect(
			trips([
				...call("Read", { path: "a.ts" }),
				...call("Read", { path: "b.ts" }),
				...call("Read", { path: "c.ts" }),
			]),
		).toEqual([]);
	});
});

describe("the turn limit", () => {
	test("a turn is one reply: parallel calls are one turn; the next reply past the limit trips", () => {
		const parallel: AgentEvent[] = [
			text("Two reads."),
			{ type: "tool-start", toolCallId: "a", name: "Read" },
			{ type: "tool-start", toolCallId: "b", name: "Read" },
			{ type: "tool-end", toolCallId: "a", name: "Read", input: { p: 1 } },
			{ type: "tool-end", toolCallId: "b", name: "Read", input: { p: 2 } },
			{ type: "tool-result", toolCallId: "a", content: "" },
			{ type: "tool-result", toolCallId: "b", content: "" },
		];
		const events = [
			...parallel, // turn 1
			...call("Bash", { command: "ls" }), // turn 2
			text("Done."), // turn 3
		];
		expect(trips(events, 3)).toEqual([]);
		expect(trips(events, 2)).toEqual([
			{ at: events.length - 1, trip: { kind: "turns", limit: 2 } },
		]);
	});

	test("a step report ends a turn", () => {
		const events: AgentEvent[] = [
			text("Reporting."),
			{ type: "report", outcome: "pass", summary: "Done." },
			text("Bye."),
		];
		expect(trips(events, 1)).toEqual([
			{ at: 2, trip: { kind: "turns", limit: 1 } },
		]);
	});

	test("without a limit nothing is counted; a guard trips once", () => {
		const many = Array.from({ length: 50 }, (_, i) =>
			call("Read", { path: `${i}.ts` }),
		).flat();
		expect(trips(many)).toEqual([]);
		expect(trips(many, 1)).toHaveLength(1);
	});
});

describe("a subagent's events", () => {
	const sub = (event: AgentEvent): AgentEvent =>
		({ ...event, parentToolCallId: "task-1" }) as AgentEvent;

	test("count for neither guard", () => {
		const events: AgentEvent[] = [
			...call("Task", { prompt: "Look." }).slice(0, 2),
			...[1, 2, 3, 4].flatMap(() =>
				[text("Again."), ...call("Read", { path: "a.ts" })].map(sub),
			),
		];
		expect(trips(events, 1)).toEqual([]);
	});

	test("thinking starts no turn", () => {
		const thinking: AgentEvent = {
			type: "thinking",
			messageId: "r1",
			delta: "Hmm.",
		};
		expect(trips([thinking, text("One."), thinking], 1)).toEqual([]);
	});
});
