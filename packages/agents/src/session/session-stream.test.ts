import { describe, expect, spyOn, test } from "bun:test";
import { effortEnv } from "../harnesses/claude-code/harness";
import { CLAUDE_CODE_PROFILE } from "../harnesses/claude-code/profile";
import type { AgentEvent } from "../port/types";
import { streamSession } from "./session-stream";
import { createTranslator } from "./translate";

const session = {
	type: "CUSTOM",
	name: "claude-code.session-id",
	value: { sessionId: "s-1" },
};

/** A source that yields `chunks`, then hangs until it is closed. */
function hangingSource(chunks: unknown[]) {
	const state = { closed: false };
	const source: AsyncIterable<unknown> = {
		[Symbol.asyncIterator]() {
			let index = 0;
			return {
				next() {
					if (index < chunks.length) {
						return Promise.resolve({ done: false, value: chunks[index++] });
					}
					return new Promise(() => {});
				},
				return() {
					state.closed = true;
					return Promise.resolve({ done: true, value: undefined });
				},
			};
		},
	};
	return { source, state };
}

async function collect(
	stream: AsyncIterable<AgentEvent>,
): Promise<AgentEvent[]> {
	const events: AgentEvent[] = [];
	for await (const event of stream) events.push(event);
	return events;
}

const translator = () =>
	createTranslator({
		fallbackSessionId: "fallback",
		profile: CLAUDE_CODE_PROFILE,
	});

describe("streamSession", () => {
	test("passes a finished stream through", async () => {
		async function* source() {
			yield session;
			yield { type: "TEXT_MESSAGE_CONTENT", messageId: "m", delta: "hi" };
			yield { type: "RUN_FINISHED" };
		}
		const events = await collect(
			streamSession({
				chunks: source(),
				translator: translator(),
				signal: new AbortController().signal,
			}),
		);
		expect(events.map((e) => e.type)).toEqual(["session", "text", "finished"]);
	});

	test("an abort ends a hanging stream with one aborted error", async () => {
		const controller = new AbortController();
		const { source, state } = hangingSource([session]);
		const events: AgentEvent[] = [];
		for await (const event of streamSession({
			chunks: source,
			translator: translator(),
			signal: controller.signal,
			abortGraceMs: 50,
		})) {
			events.push(event);
			if (event.type === "session") controller.abort();
		}
		expect(events).toEqual([
			{ type: "session", sessionId: "s-1" },
			{ type: "error", kind: "aborted", message: "The session was aborted" },
		]);
		expect(state.closed).toBe(true);
	});

	test("an already-aborted signal still yields session then aborted", async () => {
		const controller = new AbortController();
		controller.abort();
		const { source } = hangingSource([session]);
		const events = await collect(
			streamSession({
				chunks: source,
				translator: translator(),
				signal: controller.signal,
			}),
		);
		expect(events).toEqual([
			{ type: "session", sessionId: "fallback" },
			{ type: "error", kind: "aborted", message: "The session was aborted" },
		]);
	});

	test("a throwing source ends with a harness error, never a throw", async () => {
		async function* source(): AsyncGenerator<unknown> {
			yield session;
			throw new Error("spawn claude ENOENT");
		}
		const logged = spyOn(console, "error").mockImplementation(() => {});
		try {
			const events = await collect(
				streamSession({
					chunks: source(),
					translator: translator(),
					signal: new AbortController().signal,
				}),
			);
			// Plain words for the person; the details go to the log.
			expect(events.at(-1)).toEqual({
				type: "error",
				kind: "harness",
				message:
					"Claude Code stopped with an error. Night Shift saved the details. Try again.",
			});
			expect(logged).toHaveBeenCalled();
		} finally {
			logged.mockRestore();
		}
	});

	test("stopping early closes the source", async () => {
		const { source, state } = hangingSource([
			session,
			{ type: "TEXT_MESSAGE_CONTENT", messageId: "m", delta: "a" },
		]);
		for await (const event of streamSession({
			chunks: source,
			translator: translator(),
			signal: new AbortController().signal,
		})) {
			if (event.type === "session") break;
		}
		await Bun.sleep(0);
		expect(state.closed).toBe(true);
	});
});

describe("effortEnv", () => {
	const knows = (model: string) => model === "opus";

	test("leaves known models to the adapter", () => {
		expect(effortEnv("opus", "high", knows)).toEqual({});
	});

	test("sets the env for other models", () => {
		expect(effortEnv("claude-opus-5", "xhigh", knows)).toEqual({
			CLAUDE_CODE_EFFORT_LEVEL: "xhigh",
		});
	});

	test("sets nothing without an effort", () => {
		expect(effortEnv("claude-opus-5", undefined, knows)).toEqual({});
	});
});
