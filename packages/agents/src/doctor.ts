import { stat } from "node:fs/promises";
import { homedir } from "node:os";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
	getDefaultEnvironment,
	StdioClientTransport,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { CLAUDE_CODE_MODELS } from "@tanstack/ai-claude-code";
import { CODEX_MODELS } from "@tanstack/ai-codex";
import { OPENCODE_MODELS } from "@tanstack/ai-opencode";

import type { HarnessName, McpServerConfig } from "./types";

/**
 * Checks for the Connections page: is each CLI on this machine, which
 * version, and whose login does it use. Every check is read-only: `--version`,
 * `auth status` and the like. Nothing here starts a session.
 */

export type CliCheck = {
	/** The executable as configured: a name on the PATH, or a path. */
	bin: string;
	/** Where it resolved to. Null when it is not there. */
	path: string | null;
	version: string | null;
	/** Whose login the CLI uses, when it says. */
	account: string | null;
	/** More facts, label → value, for example a plan or token scopes. */
	facts: { label: string; value: string }[];
	/** Why it cannot run Night Shift's sessions. Null when it can. */
	problem: string | null;
	checkedAt: number;
};

const TIMEOUT_MS = 15_000;

type Output = { code: number; stdout: string; stderr: string };

async function run(argv: string[]): Promise<Output> {
	const child = Bun.spawn(argv, {
		cwd: homedir(),
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
		env: { ...process.env, NO_COLOR: "1" },
	});
	const timer = setTimeout(() => child.kill(), TIMEOUT_MS);
	try {
		const [stdout, stderr, code] = await Promise.all([
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
			child.exited,
		]);
		return { code, stdout, stderr };
	} finally {
		clearTimeout(timer);
	}
}

/** The executable's path: a path as given when it exists, else the PATH lookup. */
export async function resolveBin(bin: string): Promise<string | null> {
	if (bin.includes("/")) {
		const path = bin.startsWith("~/") ? homedir() + bin.slice(1) : bin;
		try {
			return (await stat(path)).isFile() ? path : null;
		} catch {
			return null;
		}
	}
	return Bun.which(bin);
}

function firstLine(text: string): string | null {
	return (
		text
			.split("\n")
			.map((l) => l.trim())
			.find(Boolean) ?? null
	);
}

async function baseCheck(
	bin: string,
	label: string,
): Promise<CliCheck & { resolved: string | null }> {
	const path = await resolveBin(bin);
	const base = {
		bin,
		path,
		resolved: path,
		version: null,
		account: null,
		facts: [],
		problem: null,
		checkedAt: Date.now(),
	};
	if (!path) {
		return {
			...base,
			problem: bin.includes("/")
				? `${bin} does not exist.`
				: `${label} is not on the daemon's PATH. Install it, or set its path.`,
		};
	}
	try {
		const out = await run([path, "--version"]);
		if (out.code !== 0) {
			return {
				...base,
				problem: firstLine(out.stderr) ?? `--version exited with ${out.code}.`,
			};
		}
		return { ...base, version: firstLine(out.stdout) };
	} catch (error) {
		return { ...base, problem: String(error) };
	}
}

async function claudeCheck(bin: string): Promise<CliCheck> {
	const { resolved, ...check } = await baseCheck(bin, "Claude Code");
	if (!resolved || check.problem) return check;
	try {
		const out = await run([resolved, "auth", "status", "--json"]);
		const status = JSON.parse(out.stdout) as {
			loggedIn?: boolean;
			email?: string;
			orgName?: string;
			subscriptionType?: string;
			authMethod?: string;
		};
		if (!status.loggedIn) {
			return {
				...check,
				problem: "Not logged in. Run `claude` once to log in.",
			};
		}
		const facts = [
			status.subscriptionType && {
				label: "Plan",
				value: status.subscriptionType,
			},
			status.orgName && { label: "Organization", value: status.orgName },
			status.authMethod && { label: "Login", value: status.authMethod },
		].filter((f): f is { label: string; value: string } => Boolean(f));
		return { ...check, account: status.email ?? null, facts };
	} catch {
		// An older Claude Code without `auth status --json`: the version is enough.
		return check;
	}
}

async function opencodeCheck(bin: string): Promise<CliCheck> {
	const { resolved, ...check } = await baseCheck(bin, "OpenCode");
	if (!resolved || check.problem) return check;
	// "opencode v2.0.22" or "1.19.2".
	const version =
		check.version?.match(/\d+\.\d+(\.\d+)?/)?.[0] ?? check.version;
	const major = version?.split(".")[0];
	if (major !== undefined && major !== "1") {
		return {
			...check,
			version,
			problem: `OpenCode ${version} is not supported: @tanstack/ai-opencode 0.5 drives OpenCode 1.x only. Point the path at a 1.x build.`,
		};
	}
	return { ...check, version };
}

async function codexCheck(bin: string): Promise<CliCheck> {
	const { resolved, ...check } = await baseCheck(bin, "Codex");
	if (!resolved || check.problem) return check;
	try {
		const out = await run([resolved, "login", "status"]);
		const line = firstLine(out.stdout) ?? firstLine(out.stderr);
		if (out.code !== 0) {
			return {
				...check,
				problem: line ?? "Not logged in. Run `codex login`.",
			};
		}
		return { ...check, account: line };
	} catch {
		return check;
	}
}

export async function checkHarness(
	harness: HarnessName,
	bin: string,
): Promise<CliCheck> {
	switch (harness) {
		case "claude-code":
			return claudeCheck(bin);
		case "opencode":
			return opencodeCheck(bin);
		case "codex":
			return codexCheck(bin);
	}
}

/** A harness adapter: the TanStack AI package that drives one coding-agent CLI. */
export type HarnessAdapter = {
	name: HarnessName;
	label: string;
	/** The `@tanstack/ai-*` package. */
	pkg: string;
	/** The CLI it runs, as found on the PATH. */
	bin: string;
	/** The models the adapter knows, for autocomplete: any other id works too. */
	models: readonly string[];
	/** The CLI's own command that lists the models it can reach, if it has one. */
	listing: readonly string[] | null;
};

/**
 * Every TanStack AI harness adapter (packages tagged `harness`). The other
 * `@tanstack/ai-*` adapters (Anthropic, OpenAI, Ollama, …) are chat
 * adapters: they cannot run tools in a worktree, so they cannot run an
 * Agent node.
 */
export const HARNESS_ADAPTERS: Record<HarnessName, HarnessAdapter> = {
	"claude-code": {
		name: "claude-code",
		label: "Claude Code",
		pkg: "@tanstack/ai-claude-code",
		bin: "claude",
		models: CLAUDE_CODE_MODELS,
		// Claude Code has no listing; its aliases (sonnet, opus, haiku) are in the adapter's list.
		listing: null,
	},
	opencode: {
		name: "opencode",
		label: "OpenCode",
		pkg: "@tanstack/ai-opencode",
		bin: "opencode",
		models: OPENCODE_MODELS,
		listing: ["models"],
	},
	codex: {
		name: "codex",
		label: "Codex",
		pkg: "@tanstack/ai-codex",
		bin: "codex",
		models: CODEX_MODELS,
		listing: null,
	},
};

export type HarnessModels = {
	/** The adapter's models, then the ones only the CLI listed. */
	models: string[];
	/** How many of `models` came from the CLI's listing and not the adapter. */
	listed: number;
	/** Why the CLI's listing did not answer. Null when it did, or when it has none. */
	problem: string | null;
	checkedAt: number;
};

/**
 * The models a harness offers: the adapter's list, plus what the CLI lists
 * itself when it can (`opencode models`: one `provider/model` per line).
 * Never throws: a CLI that cannot answer leaves the adapter's list, so the
 * picker is never empty.
 */
export async function harnessModels(
	harness: HarnessName,
	bin: string,
): Promise<HarnessModels> {
	const adapter = HARNESS_ADAPTERS[harness];
	const known = [...adapter.models];
	const result = (listedModels: string[], problem: string | null) => {
		const extra = listedModels.filter((m) => !known.includes(m));
		return {
			models: [...known, ...extra],
			listed: extra.length,
			problem,
			checkedAt: Date.now(),
		};
	};
	if (!adapter.listing) return result([], null);
	const path = await resolveBin(bin);
	if (!path) return result([], `${bin} is not there.`);
	try {
		const out = await run([path, ...adapter.listing]);
		if (out.code !== 0) {
			return result(
				[],
				firstLine(out.stderr) ??
					`${adapter.listing.join(" ")} exited with ${out.code}.`,
			);
		}
		const listed = out.stdout
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => line.includes("/") && !/\s/.test(line));
		return result([...new Set(listed)], null);
	} catch (error) {
		return result([], String(error));
	}
}

/** `gh`: the For Each GitHub source and the GitHub tools run it with the user's login. */
export async function checkGithub(bin: string): Promise<CliCheck> {
	const { resolved, ...check } = await baseCheck(bin, "The GitHub CLI");
	if (!resolved || check.problem) return check;
	try {
		// `auth status` prints to stderr and never shows the token in full.
		const out = await run([
			resolved,
			"auth",
			"status",
			"--hostname",
			"github.com",
		]);
		const text = `${out.stdout}\n${out.stderr}`;
		const account = text.match(/Logged in to github\.com account (\S+)/)?.[1];
		if (out.code !== 0 || !account) {
			return {
				...check,
				problem: "Not logged in to github.com. Run `gh auth login`.",
			};
		}
		const scopes = text.match(/Token scopes: (.+)/)?.[1]?.replaceAll("'", "");
		return {
			...check,
			version: check.version?.replace(/^gh version /, "") ?? null,
			account,
			facts: scopes ? [{ label: "Scopes", value: scopes }] : [],
		};
	} catch {
		return check;
	}
}

export type McpTestResult = {
	ok: boolean;
	server: { name: string; version: string } | null;
	tools: { name: string; description: string | null }[];
	error: string | null;
	ms: number;
};

/**
 * Connects to one MCP server, lists its tools, and disconnects. A command
 * server starts in the home directory. `redact` lists secret values to
 * take out of any error text.
 */
export async function testMcpServer(
	config: McpServerConfig,
	options: { redact?: string[]; timeoutMs?: number } = {},
): Promise<McpTestResult> {
	const started = Date.now();
	const client = new Client({ name: "nightshift", version: "1.0.0" });
	const transport =
		"command" in config
			? new StdioClientTransport({
					command: config.command,
					args: config.args,
					env: { ...getDefaultEnvironment(), ...config.env },
					cwd: homedir(),
					stderr: "pipe",
				})
			: new StreamableHTTPClientTransport(new URL(config.url), {
					requestInit: { headers: config.headers },
				});
	const redact = (text: string) =>
		(options.redact ?? [])
			.filter((v) => v.length >= 4)
			.reduce((t, v) => t.replaceAll(v, "•••"), text);
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		const timeout = new Promise<never>((_, reject) => {
			timer = setTimeout(
				() =>
					reject(
						new Error(
							`No answer within ${Math.round((options.timeoutMs ?? 20_000) / 1000)} s.`,
						),
					),
				options.timeoutMs ?? 20_000,
			);
		});
		await Promise.race([client.connect(transport), timeout]);
		const { tools } = await Promise.race([client.listTools(), timeout]);
		const version = client.getServerVersion();
		return {
			ok: true,
			server: version ? { name: version.name, version: version.version } : null,
			tools: tools.map((t) => ({
				name: t.name,
				description: t.description ?? null,
			})),
			error: null,
			ms: Date.now() - started,
		};
	} catch (error) {
		return {
			ok: false,
			server: null,
			tools: [],
			error: redact(error instanceof Error ? error.message : String(error)),
			ms: Date.now() - started,
		};
	} finally {
		clearTimeout(timer);
		await client.close().catch(() => {});
	}
}
