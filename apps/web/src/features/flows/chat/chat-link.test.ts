import { describe, expect, test } from "bun:test";
import {
	chatAboutRun,
	chatAboutSaving,
	chatSearch,
	linkEntry,
	parseChatLink,
} from "./chat-link";

describe("the chat link", () => {
	test("reads back what it writes", () => {
		expect(parseChatLink(chatSearch({ kind: "open" }))).toEqual({
			kind: "open",
		});
		expect(parseChatLink(chatAboutRun("run-1"))).toEqual({
			kind: "run",
			runId: "run-1",
		});
		expect(parseChatLink(chatSearch({ kind: "improve" }))).toEqual({
			kind: "improve",
		});
	});

	test("the search values stay as they were", () => {
		expect(chatSearch({ kind: "open" })).toBe("open");
		expect(chatAboutRun("run-1")).toBe("run:run-1");
		expect(parseChatLink("save:costly:run-1:write / build:2")).toEqual({
			kind: "run",
			runId: "run-1",
			saving: { kind: "costly", step: "write / build:2" },
		});
	});

	test("each link names the entry it starts", () => {
		expect(linkEntry({ kind: "open" })).toBeUndefined();
		expect(linkEntry({ kind: "improve" })).toBe("flow.improve");
		expect(linkEntry({ kind: "run", runId: "r" })).toBe("run.improve");
		expect(
			linkEntry({ kind: "run", runId: "r", saving: { kind: "nothing" } }),
		).toBe("spend.saving");
	});

	test("a way to save keeps its kind, its run and its step", () => {
		expect(
			parseChatLink(
				chatAboutSaving({
					kind: "costly",
					runId: "run-1",
					step: { nodeId: "build:2", via: "write" },
				}),
			),
		).toEqual({
			kind: "run",
			runId: "run-1",
			saving: { kind: "costly", step: "write / build:2" },
		});
		expect(
			parseChatLink(chatAboutSaving({ kind: "unfinished", runId: "run-1" })),
		).toEqual({
			kind: "run",
			runId: "run-1",
			saving: { kind: "unfinished" },
		});
	});

	test("anything else opens nothing", () => {
		for (const value of [
			undefined,
			3,
			"",
			"run:",
			"run:  ",
			"other",
			"save:",
			"save:costly",
			"save:costly: ",
			"save:other:run-1",
		]) {
			expect(parseChatLink(value)).toBeUndefined();
		}
	});
});
