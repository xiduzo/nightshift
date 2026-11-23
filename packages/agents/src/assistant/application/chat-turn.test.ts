import { describe, expect, test } from "bun:test";
import { inMemoryAssistantSessions } from "../adapters/out/in-memory-assistant-sessions";
import { chatTurn } from "./chat-turn";

describe("chatTurn", () => {
	test("binds to the session port", () => {
		const run = chatTurn({
			sessions: inMemoryAssistantSessions(),
			chatTools: {
				forTurn: () => [],
				describeTool: () => undefined,
				limits: () => ({}),
			},
		});
		expect(typeof run).toBe("function");
	});
});