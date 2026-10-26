import { describe, expect, test } from "bun:test";
import {
	type ChatEvent,
	type ChatRequest,
	FLOW_VERSION,
	flowSchema,
} from "@nightshift/flows";
import { type ChatClient, followChat, NO_ANSWER } from "./follow-chat";

const request: ChatRequest = {
	projectId: "p1",
	flowName: "build",
	flow: flowSchema.parse({
		version: FLOW_VERSION,
		start: "build",
		nodes: [],
		edges: [],
	}),
	message: "Run the tests",
};

function fakeClient(events: ChatEvent[], fail?: Error): ChatClient {
	return {
		assistant: {
			chat: async () => {
				if (fail) throw fail;
				return (async function* () {
					yield* events;
				})();
			},
		},
	};
}

async function follow(client: ChatClient, controller = new AbortController()) {
	const seen: ChatEvent[] = [];
	const end = await followChat({
		client,
		request,
		signal: controller.signal,
		onEvent: (event) => seen.push(event),
	});
	return { end, seen };
}

describe("followChat", () => {
	test("passes each event on and ends on done", async () => {
		const { end, seen } = await follow(
			fakeClient([
				{ type: "thread", threadId: "t1" },
				{ type: "text", delta: "Hi" },
				{ type: "done" },
				{ type: "text", delta: "after the end" },
			]),
		);
		expect(end).toEqual({ kind: "done" });
		expect(seen.map((event) => event.type)).toEqual(["thread", "text", "done"]);
	});

	test("an error event ends it", async () => {
		const { end, seen } = await follow(
			fakeClient([{ type: "error", message: "No profile" }]),
		);
		expect(end).toEqual({ kind: "error", message: "No profile" });
		expect(seen).toHaveLength(1);
	});

	test("a stream without an end, or a failed call, is broken", async () => {
		expect(
			(await follow(fakeClient([{ type: "text", delta: "Hi" }]))).end,
		).toEqual({ kind: "broken", message: NO_ANSWER });
		expect(
			(await follow(fakeClient([], new Error("Could not reach the server"))))
				.end,
		).toEqual({ kind: "broken", message: "Could not reach the server" });
	});

	test("a stopped answer is stopped, not broken", async () => {
		const controller = new AbortController();
		controller.abort();
		const { end, seen } = await follow(
			fakeClient([{ type: "text", delta: "Hi" }]),
			controller,
		);
		expect(end).toEqual({ kind: "stopped" });
		expect(seen).toEqual([]);
	});
});
