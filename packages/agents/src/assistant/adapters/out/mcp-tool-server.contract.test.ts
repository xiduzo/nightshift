import { describe, test } from "bun:test";
import { mcpToolServerContract } from "./mcp-tool-server.contract";
import { inMemoryMcpToolServer } from "./in-memory-mcp-tool-server";
import { mcpToolServer } from "./node-mcp-tool-server";

describe("McpToolServer", () => {
	test("in-memory matches the contract", () => {
		mcpToolServerContract(inMemoryMcpToolServer());
	});
	test("mcp adapter matches the contract", () => {
		mcpToolServerContract(mcpToolServer());
	});
});