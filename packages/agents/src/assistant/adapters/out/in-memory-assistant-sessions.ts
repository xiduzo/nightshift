import type { AssistantSessions } from "../../application/ports";
import { harnessAssistantSessions } from "./harness-assistant-sessions";

/** In-memory twin: the real harness adapter in this process. */
export const inMemoryAssistantSessions = (): AssistantSessions =>
	harnessAssistantSessions();