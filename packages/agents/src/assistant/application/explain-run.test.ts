import { describe, expect, test } from "bun:test";
import { inMemoryAssistantSessions } from "../adapters/out/in-memory-assistant-sessions";
import { explainRun } from "./explain-run";

describe("explainRun", () => {
	test("binds to the session port", () => {
		const run = explainRun({ sessions: inMemoryAssistantSessions() });
		expect(typeof run).toBe("function");
	});
});