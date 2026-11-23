import { describe, expect, test } from "bun:test";
import { inMemoryAssistantSessions } from "../../adapters/out/in-memory-assistant-sessions";
import { suggestField } from "./suggest-field";

describe("suggestField", () => {
	test("binds to the session port", () => {
		const run = suggestField({ sessions: inMemoryAssistantSessions() });
		expect(typeof run).toBe("function");
	});
});