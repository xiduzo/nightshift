import { describe, expect, test } from "bun:test";

import {
	redactExec,
	redactSession,
	redactText,
	streamRedactor,
} from "./redact";
import type { ExecEvent } from "./types";

/** Every chunk through one redactor, then what it held back. */
function through(values: string[], chunks: string[]): string[] {
	const redactor = streamRedactor(values);
	return [...chunks.map((chunk) => redactor.push(chunk)), redactor.flush()];
}

describe("streamRedactor", () => {
	test("a value inside one chunk becomes •••", () => {
		expect(through(["hunter2"], ["login hunter2 ok\n"])).toEqual([
			"login ••• ok\n",
			"",
		]);
	});

	test("a value split over chunks is still found, and only its start waits", () => {
		expect(through(["hunter2"], ["login hun", "ter2 ok\n"])).toEqual([
			"login ",
			"••• ok\n",
			"",
		]);
		expect(through(["hunter2"], ["h", "u", "n", "t", "e", "r", "2!"])).toEqual([
			"",
			"",
			"",
			"",
			"",
			"",
			"•••!",
			"",
		]);
	});

	test("an end that only looks like a value comes out with the next chunk or the flush", () => {
		expect(through(["hunter2"], ["the hunt", "ing\n"])).toEqual([
			"the ",
			"hunting\n",
			"",
		]);
		expect(through(["hunter2"], ["the hunt"])).toEqual(["the ", "hunt"]);
	});

	test("a longer value goes first, and an empty value is ignored", () => {
		expect(through(["abc", "abcdef", ""], ["abcdef abc\n"])).toEqual([
			"••• •••\n",
			"",
		]);
	});

	test("a value as it appears inside a JSON string goes too", () => {
		const value = 'p"w\\1';
		const json = JSON.stringify({ password: value });
		const [out = "", rest = ""] = through([value], [json]);
		expect(JSON.parse(out + rest)).toEqual({ password: "•••" });
	});

	test("without values the text passes as it is", () => {
		expect(through([], ["a", "b"])).toEqual(["a", "b", ""]);
	});
});

describe("redactText", () => {
	test("takes every value out of one text", () => {
		expect(redactText("a hunter2 b hunter2", ["hunter2"])).toBe("a ••• b •••");
	});
});

describe("redactExec", () => {
	async function* events(...items: ExecEvent[]): AsyncGenerator<ExecEvent> {
		yield* items;
	}

	test("redacts each stream on its own, flushes before the exit, and redacts a start error", async () => {
		const out: ExecEvent[] = [];
		for await (const event of redactExec(
			events(
				{ type: "output", stream: "stdout", text: "pass hun" },
				{ type: "output", stream: "stderr", text: "hunter2\n" },
				{ type: "output", stream: "stdout", text: "ter2" },
				{ type: "output", stream: "stdout", text: " then hun" },
				{ type: "exit", exitCode: null, spawnError: "bad hunter2" },
			),
			["hunter2"],
		)) {
			out.push(event);
		}
		expect(out).toEqual([
			{ type: "output", stream: "stdout", text: "pass " },
			{ type: "output", stream: "stderr", text: "•••\n" },
			{ type: "output", stream: "stdout", text: "•••" },
			{ type: "output", stream: "stdout", text: " then " },
			{ type: "output", stream: "stdout", text: "hun" },
			{ type: "exit", exitCode: null, spawnError: "bad •••" },
		]);
	});
});

describe("redactSession", () => {
	async function* from<T>(items: T[]): AsyncGenerator<T> {
		for (const item of items) yield item;
	}
	const collectAll = async <T>(stream: AsyncIterable<T>) => {
		const out: T[] = [];
		for await (const item of stream) out.push(item);
		return out;
	};

	test("a value split over the deltas of a message is masked, and the text stays whole", async () => {
		const events = await collectAll(
			redactSession(
				from([
					{ type: "text", messageId: "m1", delta: "token: tok-" },
					{ type: "text", messageId: "m1", delta: "work, done" },
					{
						type: "tool-result",
						toolCallId: "t1",
						content: "tok-work",
					},
					{ type: "text", messageId: "m2", delta: "ends with tok-wo" },
					{ type: "finished" },
				]),
				["tok-work"],
			),
		);
		const text = (id: string) =>
			events
				.flatMap((e) =>
					e.type === "text" && "messageId" in e && e.messageId === id
						? [e.delta]
						: [],
				)
				.join("");
		expect(text("m1")).toBe("token: •••, done");
		expect(text("m2")).toBe("ends with tok-wo");
		expect(events).toContainEqual({
			type: "tool-result",
			toolCallId: "t1",
			content: "•••",
		});
		expect(events.at(-1)).toEqual({ type: "finished" });
	});

	test("thinking is masked like text, and a subagent's deltas keep their call", async () => {
		const events = await collectAll(
			redactSession(
				from([
					{ type: "thinking", messageId: "m1", delta: "use tok-" },
					{ type: "thinking", messageId: "m1", delta: "work now" },
					{ type: "text", messageId: "m1", delta: "Done" },
					{
						type: "text",
						messageId: "s1",
						delta: "has tok-wo",
						parentToolCallId: "task-1",
					},
					{ type: "finished" },
				]),
				["tok-work"],
			),
		);
		const joined = (type: string, id: string) =>
			events
				.flatMap((e) =>
					e.type === type && "messageId" in e && e.messageId === id
						? [e.delta]
						: [],
				)
				.join("");
		expect(joined("thinking", "m1")).toBe("use ••• now");
		expect(joined("text", "m1")).toBe("Done");
		// The held end of the subagent's text keeps its call when it is flushed.
		expect(
			events.filter((e) => e.type === "text" && "parentToolCallId" in e),
		).toEqual([
			{
				type: "text",
				messageId: "s1",
				delta: "has ",
				parentToolCallId: "task-1",
			},
			{
				type: "text",
				messageId: "s1",
				delta: "tok-wo",
				parentToolCallId: "task-1",
			},
		]);
	});
});
