import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { testMcpServer } from "./doctor";
import { callMcpTool, listMcpTools, withMcpClient } from "./mcp";
import type { McpServerConfig } from "./types";

/** The shared MCP client against the fake stdio server in `fixtures/fake-mcp.ts`. */

export const fakeMcpConfig = (
	env: Record<string, string> = {},
): McpServerConfig => ({
	command: process.execPath,
	args: [join(import.meta.dir, "fixtures", "fake-mcp.ts")],
	env,
});

describe("the MCP client", () => {
	test("lists the tools with their input schemas", async () => {
		const tools = await listMcpTools(fakeMcpConfig());
		const create = tools.find((t) => t.name === "create_issue");
		expect(create?.description).toBe("Creates an issue and returns it.");
		expect(create?.inputSchema).toMatchObject({
			type: "object",
			properties: {
				title: { type: "string", description: "The issue title" },
				teamId: { type: "string" },
			},
			required: ["title"],
		});
		expect(tools.map((t) => t.name).sort()).toEqual([
			"create_issue",
			"fail",
			"list_json",
			"say",
			"slow",
			"typed",
			"whoami",
		]);
	});

	test("calls a tool and reads structured content, text and isError", async () => {
		const call = (name: string, args: Record<string, unknown>) =>
			withMcpClient(fakeMcpConfig(), (client) =>
				callMcpTool(client, name, args),
			);
		expect(await call("create_issue", { title: "Fix it" })).toEqual({
			text: "Created ISS-1",
			structuredContent: {
				id: "ISS-1",
				title: "Fix it",
				url: "https://tracker.example/ISS-1",
			},
			isError: false,
		});
		expect(await call("say", { text: "hi" })).toEqual({
			text: "You said: hi\nBye.",
			structuredContent: null,
			isError: false,
		});
		expect(await call("fail", { reason: "nope" })).toEqual({
			text: "nope",
			structuredContent: null,
			isError: true,
		});
	});

	test("the server gets the config's environment", async () => {
		const text = await withMcpClient(
			fakeMcpConfig({ FAKE_MCP_TOKEN: "s3cret" }),
			async (client) => (await callMcpTool(client, "whoami", {})).text,
		);
		expect(text).toBe("s3cret");
	});

	test("a timeout and an abort reject and close the client", async () => {
		await expect(
			withMcpClient(
				fakeMcpConfig(),
				(client) => client.callTool({ name: "slow", arguments: { ms: 5_000 } }),
				{ timeoutMs: 300 },
			),
		).rejects.toThrow("No answer within 0 s.");
		const controller = new AbortController();
		setTimeout(() => controller.abort(new Error("stopped")), 100);
		await expect(
			withMcpClient(
				fakeMcpConfig(),
				(client) => client.callTool({ name: "slow", arguments: { ms: 5_000 } }),
				{ signal: controller.signal },
			),
		).rejects.toThrow("stopped");
	});

	test("a server that cannot start is an error, not a hang", async () => {
		await expect(
			listMcpTools(
				{ command: "/nonexistent/mcp-server", args: [], env: {} },
				{ timeoutMs: 2_000 },
			),
		).rejects.toThrow();
	});

	test("the Connections page's test uses the same client and lists the schemas too", async () => {
		const result = await testMcpServer(fakeMcpConfig());
		expect(result.ok).toBe(true);
		expect(result.server).toEqual({ name: "fake-mcp", version: "1.0.0" });
		expect(
			result.tools.find((t) => t.name === "say")?.inputSchema,
		).toMatchObject({
			type: "object",
			properties: { text: { type: "string" } },
		});
	});
});
