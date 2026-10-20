import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { testMcpServer } from "./mcp-test";

let dir: string;
beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "nightshift-mcp-test-"));
});
afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

describe("testMcpServer", () => {
	const sdk = (path: string) =>
		fileURLToPath(import.meta.resolve(`@modelcontextprotocol/sdk/${path}`));

	/** A stdio MCP server: an `echo` tool, plus a tool named by FIXTURE_TOOL. FIXTURE_HANG never answers. */
	async function fixtureServer(): Promise<string> {
		const path = join(dir, "server.ts");
		await writeFile(
			path,
			`import { McpServer } from ${JSON.stringify(sdk("server/mcp.js"))};
import { StdioServerTransport } from ${JSON.stringify(sdk("server/stdio.js"))};

if (process.env.FIXTURE_HANG) await new Promise(() => {});
const server = new McpServer({ name: "fixture", version: "1.2.3" });
const text = (t) => ({ content: [{ type: "text", text: t }] });
server.registerTool("echo", { description: "Says it back." }, async () => text("echo"));
if (process.env.FIXTURE_TOOL) {
	server.registerTool(process.env.FIXTURE_TOOL, {}, async () => text("extra"));
}
await server.connect(new StdioServerTransport());
`,
		);
		return path;
	}

	test("connects, lists the tools and names the server", async () => {
		const server = await fixtureServer();
		const result = await testMcpServer({
			command: process.execPath,
			args: [server],
			env: { FIXTURE_TOOL: "from_env" },
		});
		expect(result).toEqual({
			ok: true,
			server: { name: "fixture", version: "1.2.3" },
			tools: [
				{
					name: "echo",
					description: "Says it back.",
					inputSchema: { type: "object", properties: {} },
				},
				// The config's env reaches the server.
				{
					name: "from_env",
					description: null,
					inputSchema: { type: "object", properties: {} },
				},
			],
			error: null,
			ms: expect.any(Number),
		});
	});

	test("a command that does not start gives ok: false with the error", async () => {
		const result = await testMcpServer({
			command: join(dir, "no-such-server"),
			args: [],
			env: {},
		});
		expect(result.ok).toBe(false);
		expect(result.server).toBeNull();
		expect(result.tools).toEqual([]);
		expect(result.error).toContain("no-such-server");
	});

	test("a command that exits at once gives ok: false", async () => {
		const result = await testMcpServer({
			command: "/bin/sh",
			args: ["-c", "exit 3"],
			env: {},
		});
		expect(result.ok).toBe(false);
		expect(result.error).toBeTruthy();
	});

	test("redact takes secret values out of the error text", async () => {
		const secret = "s3cret-token-value";
		const result = await testMcpServer(
			{ command: join(dir, secret), args: [], env: {} },
			// A value under 4 characters is not redacted: it would mangle the text.
			{ redact: [secret, "no"] },
		);
		expect(result.ok).toBe(false);
		expect(result.error).not.toContain(secret);
		expect(result.error).toContain("•••");
		expect(result.error).toContain("no such file");
	});

	test("a server that never answers times out", async () => {
		const server = await fixtureServer();
		const result = await testMcpServer(
			{ command: process.execPath, args: [server], env: { FIXTURE_HANG: "1" } },
			{ timeoutMs: 1_000 },
		);
		expect(result).toMatchObject({
			ok: false,
			server: null,
			tools: [],
			error: "No answer within 1 s.",
		});
		expect(result.ms).toBeGreaterThanOrEqual(900);
	});
});
