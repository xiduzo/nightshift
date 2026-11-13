import { describe, expect, test } from "bun:test";
import {
	chatAboutMove,
	chatAboutRun,
	chatAboutSaving,
	chatSearch,
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

	test("a next change to try keeps its kind, its run and its step", () => {
		expect(
			parseChatLink(
				chatAboutMove({ kind: "edge", runId: "run-1", step: "write:2" }),
			),
		).toEqual({
			kind: "run",
			runId: "run-1",
			move: { kind: "edge", step: "write:2" },
		});
		expect(
			parseChatLink(chatAboutMove({ kind: "rate", runId: "run-1" })),
		).toEqual({
			kind: "run",
			runId: "run-1",
			move: { kind: "rate" },
		});
		expect(parseChatLink("move:nope:run-1")).toBeUndefined();
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
