import type { BridgedTool } from "../../port";
import type { ToolServerResource } from "../domain/mcp";
import type { McpToolServer } from "./ports";

export type ToolServerResources = {
	list(): Promise<ToolServerResource[]>;
	read(uri: string): Promise<{ text: string; mimeType: string } | null>;
};

export type ToolServerInfo = {
	name: string;
	version: string;
	instructions?: string;
	resources?: ToolServerResources;
};

export const serveTools =
	(ports: { mcp: McpToolServer }) =>
	async (
		tools: readonly BridgedTool[],
		info: ToolServerInfo,
		transport?: import("@modelcontextprotocol/server").Transport,
	) => ports.mcp.serve(tools, info, transport);