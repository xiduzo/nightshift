import { describe, expect, test } from "bun:test";
import { inMemoryAssistantSessions } from "../adapters/out/in-memory-assistant-sessions";
import { checkAgent } from "./check-agent";

describe("checkAgent", () => {
	test("binds to the session port", () => {
		const run = checkAgent({ sessions: inMemoryAssistantSessions() });
		expect(typeof run).toBe("function");
	});
});