import { expect, test } from "bun:test";
import { join } from "node:path";

/**
 * The package root loads no harness adapter, decider provider, sandbox or
 * MCP SDK: each loads on its first session or call. A fresh process
 * imports the root and lists the packages it loaded.
 */
test("importing the package loads no adapter until a session needs it", async () => {
	const root = join(import.meta.dir, "index.ts");
	const proc = Bun.spawn(
		[
			process.execPath,
			"-e",
			`await import(${JSON.stringify(root)});
			console.log(JSON.stringify(Object.keys(require.cache)));`,
		],
		{ stdout: "pipe", stderr: "inherit" },
	);
	const [out, code] = await Promise.all([
		new Response(proc.stdout).text(),
		proc.exited,
	]);
	expect(code).toBe(0);
	const loaded = (JSON.parse(out) as string[]).join("\n");
	for (const pkg of [
		"@tanstack/ai-claude-code",
		"@tanstack/ai-codex",
		"@tanstack/ai-opencode",
		"@tanstack/ai-grok-build",
		"@tanstack/ai-acp",
		"@agentclientprotocol/sdk",
		"@tanstack/ai-sandbox",
		"@tanstack/ai-sandbox-local-process",
		"@tanstack/ai-openrouter",
		"@tanstack/ai-openai",
		"@tanstack/ai-typesafe",
		"@tanstack/ai-ollaya",
		"@modelcontextprotocol/sdk",
	]) {
		expect(loaded).not.toContain(`/node_modules/${pkg}/`);
	}
});
