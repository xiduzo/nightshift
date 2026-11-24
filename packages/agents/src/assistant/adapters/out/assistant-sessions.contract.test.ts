import { describe, test } from "bun:test";
import { assistantSessionsContract } from "./assistant-sessions.contract";
import { harnessAssistantSessions } from "./harness-assistant-sessions";
import { inMemoryAssistantSessions } from "./in-memory-assistant-sessions";

describe("AssistantSessions", () => {
	test("in-memory matches the contract", () => {
		assistantSessionsContract(inMemoryAssistantSessions());
	});
	test("harness matches the contract", () => {
		assistantSessionsContract(harnessAssistantSessions());
	});
});
