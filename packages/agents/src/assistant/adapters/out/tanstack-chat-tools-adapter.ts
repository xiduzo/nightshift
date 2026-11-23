import type { ChatTools } from "../../application/chat-turn";
import {
	chatAgentLimits,
	chatToolsForTurn,
	describeChatTool,
} from "./tanstack-chat-tools";

export function tanstackChatTools(): ChatTools {
	return {
		forTurn: chatToolsForTurn,
		describeTool: describeChatTool,
		limits: chatAgentLimits,
	};
}