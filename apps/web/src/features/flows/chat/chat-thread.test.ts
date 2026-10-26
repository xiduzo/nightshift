import { describe, expect, test } from "bun:test";
import { FLOW_VERSION, type FlowProposal, flowSchema } from "@nightshift/flows";
import {
	applyChatEvent,
	EMPTY_THREAD,
	endAnswer,
	openProposal,
	readThread,
	setProposalStatus,
	startAnswer,
	threadKey,
	writeThread,
} from "./chat-thread";

const proposal: FlowProposal = {
	flow: flowSchema.parse({
		version: FLOW_VERSION,
		start: "build",
		nodes: [],
		edges: [],
	}),
	summary: "Adds a test step.",
	issues: [],
};

const asked = startAnswer(EMPTY_THREAD, "Run the tests", {
	person: "1:person",
	agent: "1:agent",
});

/** A store in memory, like sessionStorage. */
function memoryStore() {
	const items = new Map<string, string>();
	return {
		items,
		getItem: (key: string) => items.get(key) ?? null,
		setItem: (key: string, value: string) => void items.set(key, value),
		removeItem: (key: string) => void items.delete(key),
	};
}

describe("a chat answer", () => {
	test("text deltas, the thread, a proposal and usage fill the last answer", () => {
		let thread = applyChatEvent(
			asked,
			{ type: "thread", threadId: "t1" },
			"{}",
		);
		thread = applyChatEvent(thread, { type: "text", delta: "I add " }, "{}");
		thread = applyChatEvent(thread, { type: "text", delta: "a step." }, "{}");
		thread = applyChatEvent(thread, { type: "activity", text: "Reads" }, "{}");
		thread = applyChatEvent(thread, { type: "proposal", proposal }, "BASE");
		thread = applyChatEvent(
			thread,
			{
				type: "usage",
				usage: { inputTokens: 1, outputTokens: 2, costUsd: 0.01 },
			},
			"{}",
		);
		expect(thread.threadId).toBe("t1");
		expect(thread.messages).toEqual([
			{ id: "1:person", role: "person", text: "Run the tests" },
			{
				id: "1:agent",
				role: "agent",
				text: "I add a step.",
				proposal: { proposal, baseJson: "BASE", status: "open" },
				usage: { inputTokens: 1, outputTokens: 2, costUsd: 0.01 },
			},
		]);
		expect(openProposal(thread)?.id).toBe("1:agent");
		const applied = setProposalStatus(thread, "1:agent", "applied");
		expect(openProposal(applied)).toBeUndefined();
	});

	test("an error event, a broken stream and a stop end the answer", () => {
		const failed = applyChatEvent(
			asked,
			{ type: "error", message: "Add a profile first." },
			"{}",
		);
		expect(failed.messages.at(-1)).toMatchObject({
			error: "Add a profile first.",
		});
		// The error event's words win over the broken stream's.
		expect(
			endAnswer(failed, { error: "Lost the connection." }).messages.at(-1),
		).toMatchObject({ error: "Add a profile first." });
		expect(endAnswer(asked, { stopped: true }).messages.at(-1)).toMatchObject({
			stopped: true,
		});
	});
});

describe("the kept chat", () => {
	test("reads back what it wrote, per project and flow", () => {
		const store = memoryStore();
		const key = threadKey("p1", "build");
		writeThread(store, key, asked);
		expect(readThread(store, key)).toEqual(asked);
		expect(readThread(store, threadKey("p1", "other"))).toEqual(EMPTY_THREAD);
		writeThread(store, key, EMPTY_THREAD);
		expect(store.items.size).toBe(0);
	});

	test("anything it cannot read is an empty chat", () => {
		const store = memoryStore();
		store.setItem("bad", "{not json");
		store.setItem("wrong", JSON.stringify({ messages: [{ role: "x" }] }));
		expect(readThread(store, "bad")).toEqual(EMPTY_THREAD);
		expect(readThread(store, "wrong")).toEqual(EMPTY_THREAD);
		expect(readThread(undefined, "any")).toEqual(EMPTY_THREAD);
		const throwing = {
			getItem: () => {
				throw new Error("blocked");
			},
			setItem: () => {
				throw new Error("full");
			},
			removeItem: () => {},
		};
		expect(readThread(throwing, "any")).toEqual(EMPTY_THREAD);
		expect(() => writeThread(throwing, "any", asked)).not.toThrow();
	});
});
