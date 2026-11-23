import { inMemoryAssistantSessions } from "../../../adapters/out/in-memory-assistant-sessions";
import type { SuggestSessions } from "../../application/ports";

/** In-memory SuggestSessions for tests (@filledBy agents/assistant). */
export function inMemorySuggestSessions(): SuggestSessions {
	return inMemoryAssistantSessions();
}
