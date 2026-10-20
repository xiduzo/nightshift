import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
	checkCli,
	checkCustomAgent,
	checkHarness,
	cliHelp,
	cliHelpAt,
	HARNESS_ADAPTERS,
	HELP_MAX_CHARS,
	harnessModels,
	pathPrograms,
	plainHelp,
	resolveBin,
	testMcpServer,
} from "./checks";

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

describe("checkCli", () => {
	test("a program on the PATH: its path and version", async () => {
		const path = await fakeCli("acli", {
			"--version": { stdout: "acli 1.2.3\n" },
		});
		expect(await checkCli("acli", dir)).toMatchObject({
			bin: "acli",
			path,
			version: "acli 1.2.3",
			problem: null,
		});
	});

	test("a program without --version is still ready", async () => {
		await fakeCli("jq", {});
		expect(await checkCli("jq", dir)).toMatchObject({
			version: null,
			problem: null,
		});
	});

	test("a program that is not there has a problem", async () => {
		const check = await checkCli("nightshift-not-anywhere", dir);
		expect(check.path).toBeNull();
		expect(check.problem).toContain("cannot find nightshift-not-anywhere");
	});
});

describe("CLI tool help", () => {
	test("checkCli has the help the program prints for --help", async () => {
		await fakeCli("acli", {
			"--version": { stdout: "acli 1.2.3\n" },
			"--help": { stdout: "Usage: acli <command>\n\n  jira  Jira\n" },
		});
		expect((await checkCli("acli", dir)).help).toBe(
			"Usage: acli <command>\n\n  jira  Jira",
		);
	});

	test("help on stderr with a non-zero exit counts when it has a usage line", async () => {
		const path = await fakeCli("old", {
			"--help": { stderr: "usage: old [-v] file\n", code: 1 },
		});
		expect(await cliHelpAt(path)).toBe("usage: old [-v] file");
	});

	test("-h when --help is not known; nothing when neither answers", async () => {
		const short = await fakeCli("short", {
			"--help": { stderr: "unknown flag --help", code: 2 },
			"-h": { stdout: "short: does one thing\n" },
		});
		expect(await cliHelpAt(short)).toBe("short: does one thing");
		const silent = await fakeCli("silent", {});
		expect(await cliHelpAt(silent)).toBeNull();
	});

	test("long help is cut at a whole line", async () => {
		const line = `${"x".repeat(99)}\n`;
		const path = await fakeCli("big", {
			"--help": { stdout: line.repeat(200) },
		});
		const help = (await cliHelpAt(path)) ?? "";
		expect(help.length).toBeLessThanOrEqual(HELP_MAX_CHARS + 2);
		expect(help).toEndWith(`${"x".repeat(99)}\n…`);
	});

	test("terminal escapes and man-page overstrike go", () => {
		expect(
			plainHelp(
				"\x1b[1mNAME\x1b[0m\r\nN\bNA\bAM\bME\bE  \n\n\n\n_\bt_\bo_\bo_\bl",
			),
		).toBe("NAME\nNAME\n\ntool");
	});

	test("cliHelp finds the program by name, and nothing for a missing one", async () => {
		await fakeCli("acli", { "--help": { stdout: "Usage: acli\n" } });
		expect(await cliHelp("acli", dir)).toBe("Usage: acli");
		expect(await cliHelp("nightshift-not-anywhere", dir)).toBeNull();
	});
});

describe("pathPrograms", () => {
	test("the executables of each directory, sorted, each once", async () => {
		await fakeCli("zeta", {});
		await fakeCli("alpha", {});
		await writeFile(join(dir, "notes.txt"), "not a program");
		const other = join(dir, "other");
		await mkdir(other);
		await writeFile(join(other, "alpha"), "#!/bin/sh\n");
		await chmod(join(other, "alpha"), 0o755);
		expect(
			await pathPrograms(`${dir}:${other}:${join(dir, "missing")}`),
		).toEqual(["alpha", "zeta"]);
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
			"Claude Code failed when Night Shift checked its version.",
		);
	});

	test("a missing binary is a problem", async () => {
		const byPath = join(dir, "nope", "claude");
		expect(await checkHarness("claude-code", byPath)).toMatchObject({
			bin: byPath,
			path: null,
			version: null,
			problem: `Nothing is installed at ${byPath}. Check the path.`,
		});
		expect(
			(await checkHarness("claude-code", "nightshift-no-such-claude")).problem,
		).toBe(
			"Claude Code is not installed, or Night Shift cannot find it. Install it, or enter its path.",
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
			"OpenCode is not installed, or Night Shift cannot find it. Install it, or enter its path.",
		);
	});
});

describe("checkCustomAgent", () => {
	test("a command that is there is ready, with or without a version", async () => {
		const bin = await fakeCli("goose", {});
		expect(await checkCustomAgent(bin, "Goose")).toMatchObject({
			path: bin,
			version: null,
			problem: null,
		});
	});

	test("a command that is not there says how to fix it", async () => {
		expect(
			(await checkCustomAgent("no-such-agent-here", "Goose")).problem,
		).toBe(
			"Night Shift cannot find no-such-agent-here on this computer. Install Goose, or enter the full path of its command.",
		);
	});
});

describe("checkHarness: pi", () => {
	test("pi 0.81 or later is ready", async () => {
		const bin = await fakeCli("pi", { "--version": { stdout: "1.3.0\n" } });
		expect(await checkHarness("pi", bin)).toMatchObject({
			version: "1.3.0",
			problem: null,
		});
	});

	test("an older pi is a problem: pi-acp would wait for it forever", async () => {
		// pi 0.73 prints its version to stderr.
		const bin = await fakeCli("pi", { "--version": { stderr: "0.73.0\n" } });
		expect((await checkHarness("pi", bin)).problem).toBe(
			"pi 0.73.0 is too old. Night Shift needs pi 0.81 or later. Update pi, or enter the path of a newer one.",
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

describe("harnessModels", () => {
	test("adds what `opencode models` lists to the adapter's models", async () => {
		const known = HARNESS_ADAPTERS.opencode.models[0] as string;
		const bin = await fakeCli("opencode", {
			models: {
				stdout: `${known}\nollama/qwen3-coder:30b\nopenrouter/z-ai/glm-4.6\nnot a model line\n`,
			},
		});
		const result = await harnessModels("opencode", bin);
		expect(result.problem).toBeNull();
		expect(result.listed).toBe(2);
		expect(
			result.models.slice(0, HARNESS_ADAPTERS.opencode.models.length),
		).toEqual([...HARNESS_ADAPTERS.opencode.models]);
		expect(result.models.slice(-2)).toEqual([
			"ollama/qwen3-coder:30b",
			"openrouter/z-ai/glm-4.6",
		]);
	});

	test("pi's model table becomes provider/model ids", async () => {
		// pi 0.73 prints the table to stderr.
		const bin = await fakeCli("pi", {
			"--list-models": {
				stderr:
					"provider  model               context  max-out\nollama    qwen3-coder:latest  128K     16.4K\nanthropic claude-opus-4-7     1M       128K\n",
			},
		});
		const result = await harnessModels("pi", bin);
		expect(result.problem).toBeNull();
		expect(result.models).toEqual([
			"default",
			"ollama/qwen3-coder:latest",
			"anthropic/claude-opus-4-7",
		]);
	});

	test("a listing that fails leaves the adapter's models, with the reason", async () => {
		const bin = await fakeCli("opencode", {
			models: { stderr: "no providers configured", code: 1 },
		});
		const result = await harnessModels("opencode", bin);
		expect(result.models).toEqual([...HARNESS_ADAPTERS.opencode.models]);
		expect(result.problem).toBe("no providers configured");
	});

	test("a harness without a listing runs nothing", async () => {
		const result = await harnessModels("claude-code", join(dir, "missing"));
		expect(result).toMatchObject({
			models: [...HARNESS_ADAPTERS["claude-code"].models],
			listed: 0,
			problem: null,
		});
	});
});
