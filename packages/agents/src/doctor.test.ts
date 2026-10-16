import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { checkGithub, checkHarness, resolveBin, testMcpServer } from "./doctor";

/** Every CLI here is a tiny fake script: the checks never run a real one. */

let dir: string;
beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "nightshift-doctor-"));
});
afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

type Answer = { stdout?: string; stderr?: string; code?: number };

const quote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;

/**
 * Writes an executable `<dir>/<name>` that answers each argv (joined with
 * spaces) as given. Any other argv exits 2, so a check that asks for
 * something else fails loudly.
 */
async function fakeCli(
	name: string,
	answers: Record<string, Answer>,
): Promise<string> {
	const path = join(dir, name);
	const cases = Object.entries(answers)
		.map(
			([argv, a]) =>
				`  ${quote(argv)})\n    printf '%s' ${quote(a.stdout ?? "")}\n    printf '%s' ${quote(a.stderr ?? "")} >&2\n    exit ${a.code ?? 0};;`,
		)
		.join("\n");
	await writeFile(
		path,
		`#!/bin/sh\ncase "$*" in\n${cases}\n  *) echo "unexpected: $*" >&2; exit 2;;\nesac\n`,
	);
	await chmod(path, 0o755);
	return path;
}

describe("resolveBin", () => {
	test("a path that is a file resolves to itself", async () => {
		const path = await fakeCli("tool", {});
		expect(await resolveBin(path)).toBe(path);
	});

	test("a missing path or a directory does not resolve", async () => {
		expect(await resolveBin(join(dir, "missing"))).toBeNull();
		await mkdir(join(dir, "folder"));
		expect(await resolveBin(join(dir, "folder"))).toBeNull();
		expect(await resolveBin("~/nightshift-surely-not-here/claude")).toBeNull();
	});

	test("a bare name is looked up on the PATH", async () => {
		expect(await resolveBin("sh")).toBe(Bun.which("sh") as string);
		expect(await resolveBin("sh")).toMatch(/\/sh$/);
		expect(await resolveBin("nightshift-doctor-not-anywhere")).toBeNull();
	});
});

describe("checkHarness: claude-code", () => {
	test("a logged-in Claude Code: version, account and plan", async () => {
		const bin = await fakeCli("claude", {
			"--version": { stdout: "2.1.3 (Claude Code)\n" },
			"auth status --json": {
				stdout: JSON.stringify({
					loggedIn: true,
					email: "night@example.com",
					orgName: "Night Shift",
					subscriptionType: "max",
					authMethod: "claude.ai",
				}),
			},
		});
		const check = await checkHarness("claude-code", bin);
		expect(check).toEqual({
			bin,
			path: bin,
			version: "2.1.3 (Claude Code)",
			account: "night@example.com",
			facts: [
				{ label: "Plan", value: "max" },
				{ label: "Organization", value: "Night Shift" },
				{ label: "Login", value: "claude.ai" },
			],
			problem: null,
			checkedAt: expect.any(Number),
		});
		expect(check).not.toHaveProperty("resolved");
	});

	test("not logged in is a problem", async () => {
		const bin = await fakeCli("claude", {
			"--version": { stdout: "2.1.3 (Claude Code)" },
			"auth status --json": {
				stdout: JSON.stringify({ loggedIn: false }),
				code: 1,
			},
		});
		const check = await checkHarness("claude-code", bin);
		expect(check.version).toBe("2.1.3 (Claude Code)");
		expect(check.account).toBeNull();
		expect(check.problem).toBe("Not logged in. Run `claude` once to log in.");
	});

	test("an older Claude Code without `auth status --json`: the version is enough", async () => {
		const bin = await fakeCli("claude", {
			"--version": { stdout: "1.0.0 (Claude Code)" },
		});
		const check = await checkHarness("claude-code", bin);
		expect(check).toMatchObject({
			version: "1.0.0 (Claude Code)",
			account: null,
			facts: [],
			problem: null,
		});
	});

	test("a failing --version is the problem, with its first stderr line", async () => {
		const bin = await fakeCli("claude", {
			"--version": { stderr: "\n  dyld: library not loaded\nmore\n", code: 1 },
		});
		const check = await checkHarness("claude-code", bin);
		expect(check.version).toBeNull();
		expect(check.problem).toBe("dyld: library not loaded");
	});

	test("a silent failing --version names its exit code", async () => {
		const bin = await fakeCli("claude", { "--version": { code: 4 } });
		expect((await checkHarness("claude-code", bin)).problem).toBe(
			"--version exited with 4.",
		);
	});

	test("a missing binary is a problem", async () => {
		const byPath = join(dir, "nope", "claude");
		expect(await checkHarness("claude-code", byPath)).toMatchObject({
			bin: byPath,
			path: null,
			version: null,
			problem: `${byPath} does not exist.`,
		});
		expect(
			(await checkHarness("claude-code", "nightshift-no-such-claude")).problem,
		).toBe(
			"Claude Code is not on the daemon's PATH. Install it, or set its path.",
		);
	});
});

describe("checkHarness: opencode", () => {
	test("OpenCode 2.x is flagged as unsupported, with the version normalised", async () => {
		const bin = await fakeCli("opencode", {
			"--version": { stdout: "opencode v2.0.22\n" },
		});
		const check = await checkHarness("opencode", bin);
		expect(check.version).toBe("2.0.22");
		expect(check.problem).toContain("OpenCode 2.0.22 is not supported");
	});

	test("OpenCode 1.x is fine", async () => {
		const bin = await fakeCli("opencode", {
			"--version": { stdout: "1.19.2\n" },
		});
		const check = await checkHarness("opencode", bin);
		expect(check.version).toBe("1.19.2");
		expect(check.problem).toBeNull();
	});

	test("a missing OpenCode is a problem", async () => {
		expect(
			(await checkHarness("opencode", "nightshift-no-such-opencode")).problem,
		).toBe(
			"OpenCode is not on the daemon's PATH. Install it, or set its path.",
		);
	});
});

describe("checkHarness: codex", () => {
	test("a logged-in Codex: the login line is the account", async () => {
		const bin = await fakeCli("codex", {
			"--version": { stdout: "codex-cli 0.50.0\n" },
			"login status": { stderr: "Logged in using ChatGPT\n" },
		});
		const check = await checkHarness("codex", bin);
		expect(check).toMatchObject({
			version: "codex-cli 0.50.0",
			account: "Logged in using ChatGPT",
			problem: null,
		});
	});

	test("a failing `login status` is the problem", async () => {
		const bin = await fakeCli("codex", {
			"--version": { stdout: "codex-cli 0.50.0" },
			"login status": { stderr: "Not logged in\n", code: 1 },
		});
		const check = await checkHarness("codex", bin);
		expect(check.account).toBeNull();
		expect(check.problem).toBe("Not logged in");
	});

	test("a silent failing `login status` says how to log in", async () => {
		const bin = await fakeCli("codex", {
			"--version": { stdout: "codex-cli 0.50.0" },
			"login status": { code: 1 },
		});
		expect((await checkHarness("codex", bin)).problem).toBe(
			"Not logged in. Run `codex login`.",
		);
	});
});

describe("checkGithub", () => {
	const GH_VERSION = {
		stdout:
			"gh version 2.80.0 (2025-10-01)\nhttps://github.com/cli/cli/releases/tag/v2.80.0\n",
	};

	test("a logged-in gh: account and token scopes", async () => {
		const bin = await fakeCli("gh", {
			"--version": GH_VERSION,
			"auth status --hostname github.com": {
				stderr: [
					"github.com",
					"  ✓ Logged in to github.com account octocat (keyring)",
					"  - Active account: true",
					"  - Git operations protocol: https",
					"  - Token: gho_************************************",
					"  - Token scopes: 'gist', 'read:org', 'repo', 'workflow'",
					"",
				].join("\n"),
			},
		});
		expect(await checkGithub(bin)).toEqual({
			bin,
			path: bin,
			version: "2.80.0 (2025-10-01)",
			account: "octocat",
			facts: [{ label: "Scopes", value: "gist, read:org, repo, workflow" }],
			problem: null,
			checkedAt: expect.any(Number),
		});
	});

	test("a login without token scopes has no facts", async () => {
		const bin = await fakeCli("gh", {
			"--version": GH_VERSION,
			"auth status --hostname github.com": {
				stdout:
					"github.com\n  ✓ Logged in to github.com account octocat (GH_TOKEN)\n",
			},
		});
		const check = await checkGithub(bin);
		expect(check.account).toBe("octocat");
		expect(check.facts).toEqual([]);
	});

	test("not logged in is a problem", async () => {
		const bin = await fakeCli("gh", {
			"--version": GH_VERSION,
			"auth status --hostname github.com": {
				stderr:
					"You are not logged into any GitHub hosts. To log in, run: gh auth login\n",
				code: 1,
			},
		});
		const check = await checkGithub(bin);
		expect(check.account).toBeNull();
		expect(check.problem).toBe(
			"Not logged in to github.com. Run `gh auth login`.",
		);
	});

	test("a missing gh is a problem", async () => {
		expect((await checkGithub("nightshift-no-such-gh")).problem).toBe(
			"The GitHub CLI is not on the daemon's PATH. Install it, or set its path.",
		);
	});
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
				{ name: "echo", description: "Says it back." },
				// The config's env reaches the server.
				{ name: "from_env", description: null },
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
