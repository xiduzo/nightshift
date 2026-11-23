import { harnessAssistantSessions } from "./adapters/out/harness-assistant-sessions";
import { mcpToolServer } from "./adapters/out/node-mcp-tool-server";
import { tanstackChatTools } from "./adapters/out/tanstack-chat-tools";
import { terminalTools } from "./adapters/out/tanstack-terminal-tools";
import { chatTurn } from "./application/chat-turn";
import { checkAgent } from "./application/check-agent";
import { explainRun } from "./application/explain-run";
import { learnFromRun } from "./application/learn-from-run";
import { serveTools } from "./application/serve-tools";
import { terminalResources } from "./application/terminal-resources";
import { wireSuggestion } from "./suggestion";

/**
 * The wiring of assistant: binds use cases to the session and MCP adapters
 * of this package, and the suggestion sub-vertical.
 */
export type Assistant = ReturnType<typeof wireAssistant>;

export function wireAssistant() {
	const ports = {
		sessions: harnessAssistantSessions(),
		mcp: mcpToolServer(),
	};
	const suggestion = wireSuggestion({ sessions: ports.sessions });
	return {
		chatTurn: chatTurn({ ...ports, chatTools: tanstackChatTools() }),
		checkAgent: checkAgent(ports),
		explainRun: explainRun(ports),
		learnFromRun: learnFromRun(ports),
		serveTools: serveTools(ports),
		terminalTools,
		terminalResources,
		suggestField: suggestion.suggestField,
	};
}
