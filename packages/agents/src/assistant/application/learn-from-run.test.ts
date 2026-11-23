import { describe, expect, test } from "bun:test";
import { inMemoryAssistantSessions } from "../adapters/out/in-memory-assistant-sessions";
import { learnFromRun } from "./learn-from-run";

describe("learnFromRun", () => {
	test("binds to the session port", () => {
		const run = learnFromRun({ sessions: inMemoryAssistantSessions() });
		expect(typeof run).toBe("function");
	});
});