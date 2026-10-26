import { describe, expect, test } from "bun:test";
import { chatAboutRun, chatSearch, parseChatLink } from "./chat-link";

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

	test("anything else opens nothing", () => {
		for (const value of [undefined, 3, "", "run:", "run:  ", "other"]) {
			expect(parseChatLink(value)).toBeUndefined();
		}
	});
});
