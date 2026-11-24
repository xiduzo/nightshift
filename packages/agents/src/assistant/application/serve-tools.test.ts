import { describe, expect, test } from "bun:test";
import { inMemoryMcpToolServer } from "../adapters/out/in-memory-mcp-tool-server";
import { serveTools } from "./serve-tools";

describe("serveTools", () => {
	test("binds the MCP port", () => {
		const serve = serveTools({ mcp: inMemoryMcpToolServer() });
		expect(typeof serve).toBe("function");
	});
});
