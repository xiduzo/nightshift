/**
 * A fake MCP server on stdio, for the MCP client and Tool node tests. It
 * speaks the real protocol through `@modelcontextprotocol/sdk`. Its tools
 * cover what a Tool node must handle: structured content, text that is
 * JSON, plain text, an `isError` result, typed arguments echoed back with
 * their types, and a slow answer.
 *
 * `FAKE_MCP_TOKEN`: when set, the `whoami` tool returns it, so a test can
 * see that a `${NAME}` secret reached the server's environment.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "fake-mcp", version: "1.0.0" });

server.registerTool(
	"create_issue",
	{
		description: "Creates an issue and returns it.",
		inputSchema: {
			title: z.string().describe("The issue title"),
			teamId: z.string().optional(),
		},
		outputSchema: { id: z.string(), title: z.string(), url: z.string() },
	},
	async ({ title }) => {
		const issue = {
			id: "ISS-1",
			title,
			url: "https://tracker.example/ISS-1",
		};
		return {
			content: [{ type: "text", text: `Created ${issue.id}` }],
			structuredContent: issue,
		};
	},
);

server.registerTool(
	"list_json",
	{
		description: "Answers with JSON text only.",
		inputSchema: { count: z.number().int().optional() },
	},
	async ({ count }) => ({
		content: [
			{
				type: "text",
				text: JSON.stringify(
					Array.from({ length: count ?? 2 }, (_, i) => ({ n: i + 1 })),
				),
			},
		],
	}),
);

server.registerTool(
	"say",
	{
		description: "Answers with plain text.",
		inputSchema: { text: z.string() },
	},
	async ({ text }) => ({
		content: [
			{ type: "text", text: `You said: ${text}` },
			{ type: "text", text: "Bye." },
		],
	}),
);

server.registerTool(
	"fail",
	{
		description: "Always fails.",
		inputSchema: { reason: z.string().optional() },
	},
	async ({ reason }) => ({
		content: [{ type: "text", text: reason ?? "It did not work." }],
		isError: true,
	}),
);

server.registerTool(
	"typed",
	{
		description: "Echoes each argument with its type.",
		inputSchema: {
			name: z.string(),
			count: z.number(),
			whole: z.number().int(),
			flag: z.boolean(),
			tags: z.array(z.string()),
			meta: z.object({}).passthrough(),
		},
	},
	async (args) => ({
		content: [{ type: "text", text: "ok" }],
		structuredContent: {
			types: Object.fromEntries(
				Object.entries(args).map(([key, value]) => [
					key,
					Array.isArray(value) ? "array" : typeof value,
				]),
			),
			args,
		},
	}),
);

server.registerTool(
	"slow",
	{ description: "Answers after a while.", inputSchema: { ms: z.number() } },
	async ({ ms }) => {
		await new Promise((resolve) => setTimeout(resolve, ms));
		return { content: [{ type: "text", text: "done" }] };
	},
);

server.registerTool(
	"whoami",
	{ description: "Returns the token from the environment." },
	async () => ({
		content: [{ type: "text", text: process.env.FAKE_MCP_TOKEN ?? "" }],
	}),
);

await server.connect(new StdioServerTransport());
