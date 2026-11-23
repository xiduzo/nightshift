import type { BridgedTool } from "../../port";
import type {
	AssistantSessionEvent,
	AssistantSessionInput,
	AssistantVia,
} from "../domain/session";
import type { ToolServerResources } from "./serve-tools";

/**
 * Runs design-time assistant sessions on this computer's harnesses.
 */
export type AssistantSessions = {
	run(input: AssistantSessionInput): AsyncGenerator<AssistantSessionEvent>;
	runReport(
		via: AssistantVia,
		input: {
			prompt: string;
			report: { output?: Record<string, unknown> };
			resumeSessionId?: string;
			signal: AbortSignal;
		},
	): AsyncGenerator<AssistantSessionEvent>;
};

/** MCP tool server: lists resources and serves tool calls on a transport. */
export type McpToolServer = {
	serve(
		tools: readonly BridgedTool[],
		info: {
			name: string;
			version: string;
			instructions?: string;
			resources?: ToolServerResources;
		},
		transport?: unknown,
	): Promise<unknown>;
};
