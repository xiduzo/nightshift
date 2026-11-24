import { serveTools } from "./adapters/in/mcp-tool-server";
import { tanstackChatTools } from "./adapters/out/tanstack-chat-tools";
import { terminalTools } from "./adapters/out/tanstack-terminal-tools";
import { chatTurn } from "./application/chat-turn";
import { checkAgent } from "./application/check-agent";
import { explainRun } from "./application/explain-run";
import { learnFromRun } from "./application/learn-from-run";
import { terminalResources } from "./application/terminal-resources";
import { toolAnnotations } from "./catalog";
import { wireSessions } from "./sessions";
import { wireSuggestion } from "./suggestion";

/**
 * The wiring of assistant: binds the use cases to the sessions, and the tool
 * server to the hints of the tools.
 */
export function wireAssistant() {
	const sessions = wireSessions();
	return {
		chatTurn: chatTurn({ ...sessions, chatTools: tanstackChatTools() }),
		checkAgent: checkAgent(sessions),
		explainRun: explainRun(sessions),
		learnFromRun: learnFromRun(sessions),
		serveTools: serveTools(toolAnnotations),
		terminalTools,
		terminalResources,
		...wireSuggestion(sessions),
	};
}
