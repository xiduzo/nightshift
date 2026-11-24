import type { McpToolServer } from "../../application/ports";
import { mcpToolServer } from "./node-mcp-tool-server";

export const inMemoryMcpToolServer = (): McpToolServer => mcpToolServer();
