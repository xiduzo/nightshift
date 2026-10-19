import { access, constants, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

import { CLAUDE_CODE_MODELS } from "@tanstack/ai-claude-code";
import { CODEX_MODELS } from "@tanstack/ai-codex";
import { GROK_BUILD_MODELS } from "@tanstack/ai-grok-build";
import { OPENCODE_MODELS } from "@tanstack/ai-opencode";

import { ACP_DEFAULT_MODEL } from "./acp";
import { HARNESS_LABELS, HARNESS_TAKE_OVER } from "./harness-facts";
import { type McpToolInfo, toolInfo, withMcpClient } from "./mcp";
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

async function run(
	argv: string[],
	env: Record<string, string> = {},
): Promise<Output> {
	const child = Bun.spawn(argv, {
		cwd: homedir(),
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
		env: { ...process.env, NO_COLOR: "1", ...env },
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
				? `Nothing is installed at ${bin}. Check the path.`
				: `${label} is not installed, or Night Shift cannot find it. Install it, or enter its path.`,
		};
	}
	try {
		const out = await run([path, "--version"]);
		if (out.code !== 0) {
			return {
				...base,
				problem:
					firstLine(out.stderr) ??
					`${label} failed when Night Shift checked its version.`,
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
			problem: `OpenCode ${version} is not supported. Night Shift works with OpenCode 1.x only. Install a 1.x version, or enter the path of one.`,
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

/** The version, and the login where the CLI can tell. Others: version only. */
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
		default: {
			const { resolved: _resolved, ...check } = await baseCheck(
				bin,
				HARNESS_ADAPTERS[harness].label,
			);
			return check;
		}
	}
}

/** A harness adapter: the TanStack AI package that drives one coding-agent CLI. */
export type HarnessAdapter = {
	name: HarnessName;
	label: string;
	/** Two letters for its tile. */
	initials: string;
	/** The `@tanstack/ai-*` package. */
	pkg: string;
	/** The CLI it runs, as found on the PATH. */
	bin: string;
	/** The models the adapter knows, for autocomplete: any other id works too. */
	models: readonly string[];
	/** A new node, or a switch to this harness, starts with this model. */
	defaultModel: string;
	/** The CLI's own command that lists the models it can reach, if it has one. */
	listing: readonly string[] | null;
	/** One line under the picker: what this harness needs. */
	note: string;
	/** Where prompts and code go. */
	offMachine: string;
	/** The command that opens a session in the CLI, given its quoted id. Null: it has none. See `harness-facts.ts`. */
	takeOver: ((sessionId: string) => string) | null;
};

/**
 * Every harness an Agent node can run on. The first four are TanStack AI
 * harness adapters (packages tagged `harness`). The others speak ACP and
 * run through `@tanstack/ai-acp` (see `acp.ts`). The other `@tanstack/ai-*`
 * adapters (Anthropic, OpenAI, Ollama, …) are chat adapters: they cannot
 * run tools in a worktree, so they cannot run an Agent node.
 */
export const HARNESS_ADAPTERS: Record<HarnessName, HarnessAdapter> = {
	"claude-code": {
		name: "claude-code",
		label: HARNESS_LABELS["claude-code"],
		initials: "CC",
		pkg: "@tanstack/ai-claude-code",
		bin: "claude",
		models: CLAUDE_CODE_MODELS,
		defaultModel: "sonnet",
		// Claude Code has no listing; its aliases (sonnet, opus, haiku) are in the adapter's list.
		listing: null,
		note: "Uses your Claude login. Model: an alias such as sonnet, or a full model id.",
		offMachine:
			"Prompts and your project's code go to Anthropic under your Claude login.",
		takeOver: HARNESS_TAKE_OVER["claude-code"],
	},
	opencode: {
		name: "opencode",
		label: HARNESS_LABELS.opencode,
		initials: "OC",
		pkg: "@tanstack/ai-opencode",
		bin: "opencode",
		models: OPENCODE_MODELS,
		defaultModel: "anthropic/claude-sonnet-4-5",
		listing: ["models"],
		note: "Model as provider/model. Needs OpenCode 1.x. Version 2.x does not work yet.",
		offMachine:
			"Prompts and code go to the model provider OpenCode is set up with.",
		takeOver: HARNESS_TAKE_OVER.opencode,
	},
	codex: {
		name: "codex",
		label: HARNESS_LABELS.codex,
		initials: "CX",
		pkg: "@tanstack/ai-codex",
		bin: "codex",
		models: CODEX_MODELS,
		defaultModel: "gpt-5.3-codex",
		listing: null,
		note: "Not fully tested yet. Uses your Codex login.",
		offMachine: "Prompts and code go to OpenAI under your Codex login.",
		takeOver: HARNESS_TAKE_OVER.codex,
	},
	"grok-build": {
		name: "grok-build",
		label: HARNESS_LABELS["grok-build"],
		initials: "GB",
		pkg: "@tanstack/ai-grok-build",
		bin: "grok",
		models: GROK_BUILD_MODELS,
		defaultModel: "grok-build",
		listing: null,
		note: "Not fully tested yet. Uses your Grok login: run grok login once.",
		offMachine: "Prompts and code go to xAI under your Grok login.",
		takeOver: HARNESS_TAKE_OVER["grok-build"],
	},
	copilot: {
		name: "copilot",
		label: HARNESS_LABELS.copilot,
		initials: "GC",
		pkg: "@tanstack/ai-acp",
		bin: "copilot",
		models: [ACP_DEFAULT_MODEL],
		defaultModel: ACP_DEFAULT_MODEL,
		listing: null,
		note: "Not fully tested yet. Uses your GitHub login. Model default uses the model Copilot is set to.",
		offMachine:
			"Prompts and code go to GitHub Copilot under your GitHub login.",
		takeOver: HARNESS_TAKE_OVER.copilot,
	},
	gemini: {
		name: "gemini",
		label: HARNESS_LABELS.gemini,
		initials: "GE",
		pkg: "@tanstack/ai-acp",
		bin: "gemini",
		models: [ACP_DEFAULT_MODEL],
		defaultModel: ACP_DEFAULT_MODEL,
		listing: null,
		note: "Not fully tested yet. Uses your Gemini CLI login. Model default uses the model Gemini CLI is set to.",
		offMachine: "Prompts and code go to Google under your Gemini CLI login.",
		takeOver: HARNESS_TAKE_OVER.gemini,
	},
	cursor: {
		name: "cursor",
		label: HARNESS_LABELS.cursor,
		initials: "CU",
		pkg: "@tanstack/ai-acp",
		bin: "agent",
		models: [ACP_DEFAULT_MODEL],
		defaultModel: ACP_DEFAULT_MODEL,
		listing: null,
		note: "Not fully tested yet. Uses your Cursor login: run agent login once.",
		offMachine: "Prompts and code go to Cursor under your Cursor login.",
		takeOver: HARNESS_TAKE_OVER.cursor,
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
	if (!path) return result([], `Night Shift cannot find ${bin}.`);
	try {
		const out = await run([path, ...adapter.listing]);
		if (out.code !== 0) {
			return result(
				[],
				firstLine(out.stderr) ?? "Night Shift could not list the models.",
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

/** A CLI tool's check: the CLI check, plus the help the agents read. */
export type CliToolCheck = CliCheck & {
	/** The program's own help (`--help`), cut to `HELP_MAX_CHARS`. Null when it has none. */
	help: string | null;
};

/**
 * A CLI tool (a program the agents may run): where it is, its version and
 * its help. Many programs do not know `--version`, so a missing version is
 * no problem. A login (`gh auth status`, `aws sts get-caller-identity`) is
 * the agent's own business: the check is the same for every program.
 */
export async function checkCli(
	name: string,
	searchPath: string = process.env.PATH ?? "",
): Promise<CliToolCheck> {
	const check = await programCheck(name, searchPath);
	return { ...check, help: check.path ? await cliHelpAt(check.path) : null };
}

async function programCheck(
	name: string,
	searchPath: string,
): Promise<CliCheck> {
	const path = Bun.which(name, { PATH: searchPath });
	const check: CliCheck = {
		bin: name,
		path,
		version: null,
		account: null,
		facts: [],
		problem: path
			? null
			: `Night Shift cannot find ${name} on this computer. Install it, then check again.`,
		checkedAt: Date.now(),
	};
	if (!path) return check;
	try {
		const out = await run([path, "--version"]);
		return out.code === 0
			? { ...check, version: firstLine(out.stdout) }
			: check;
	} catch {
		return check;
	}
}

/** At most this much of a program's help: its commands and flags, not a manual. */
export const HELP_MAX_CHARS = 8_000;

/** No pager, no color, no cursor tricks, and lines a prompt can hold. */
const HELP_ENV: Record<string, string> = {
	PAGER: "cat",
	MANPAGER: "cat",
	GIT_PAGER: "cat",
	TERM: "dumb",
	CLICOLOR: "0",
	COLUMNS: "100",
};

/** Help text as plain text: no terminal escapes, no man-page overstrike, no blank runs. */
export function plainHelp(text: string): string {
	return (
		text
			// biome-ignore lint/suspicious/noControlCharactersInRegex: terminal escapes.
			.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "")
			// biome-ignore lint/suspicious/noControlCharactersInRegex: overstrike (`X\bX`, `_\bX`).
			.replace(/[^\n]\x08/g, "")
			.replace(/\r\n?/g, "\n")
			.replace(/[ \t]+$/gm, "")
			.replace(/\n{3,}/g, "\n\n")
			.trim()
	);
}

/** Cuts help at the last whole line within `HELP_MAX_CHARS`, and says so. */
function capHelp(text: string): string {
	if (text.length <= HELP_MAX_CHARS) return text;
	const cut = text.slice(0, HELP_MAX_CHARS);
	const lastLine = cut.lastIndexOf("\n");
	return `${lastLine > 0 ? cut.slice(0, lastLine) : cut}\n…`;
}

/**
 * The program's own help: `--help`, else `-h`. Many programs print it to
 * stderr, and some exit non-zero after it: that counts when the text has a
 * usage line. Null when neither flag answers with help.
 */
export async function cliHelpAt(path: string): Promise<string | null> {
	for (const flag of ["--help", "-h"]) {
		try {
			const out = await run([path, flag], HELP_ENV);
			const text = plainHelp(out.stdout.trim() ? out.stdout : out.stderr);
			if (text && (out.code === 0 || /usage/i.test(text))) {
				return capHelp(text);
			}
		} catch {
			// Try the next flag.
		}
	}
	return null;
}

const helpCache = new Map<string, { stamp: string; help: string }>();

/**
 * A CLI tool's help for an agent session: `cliHelpAt`, kept until the
 * program changes (a new version is a new file). Null when this computer
 * cannot find it, or it has no help.
 */
export async function cliHelp(
	name: string,
	searchPath: string = process.env.PATH ?? "",
): Promise<string | null> {
	const path = Bun.which(name, { PATH: searchPath });
	if (!path) return null;
	let stamp: string;
	try {
		const info = await stat(path);
		stamp = `${info.mtimeMs}:${info.size}`;
	} catch {
		return null;
	}
	const cached = helpCache.get(path);
	if (cached?.stamp === stamp) return cached.help;
	const help = await cliHelpAt(path);
	// No help may be a slow start or a timeout: ask again next time.
	if (help) helpCache.set(path, { stamp, help });
	return help;
}

/**
 * The programs this computer can run by name: every executable file in the
 * directories of the daemon's PATH, sorted, each name once.
 */
export async function pathPrograms(
	path: string = process.env.PATH ?? "",
): Promise<string[]> {
	const names = new Set<string>();
	for (const dir of new Set(path.split(delimiter).filter(Boolean))) {
		let entries: string[];
		try {
			entries = await readdir(dir);
		} catch {
			continue;
		}
		await Promise.all(
			entries.map(async (entry) => {
				if (names.has(entry) || entry.startsWith(".")) return;
				try {
					const file = join(dir, entry);
					if (!(await stat(file)).isFile()) return;
					await access(file, constants.X_OK);
					names.add(entry);
				} catch {
					// Not executable, or a broken link.
				}
			}),
		);
	}
	return [...names].sort((a, b) => a.localeCompare(b));
}

export type McpTestResult = {
	ok: boolean;
	server: { name: string; version: string } | null;
	tools: McpToolInfo[];
	error: string | null;
	ms: number;
};

/**
 * Connects to one MCP server, lists its tools, and disconnects
 * (`withMcpClient`). `redact` lists secret values to take out of any error
 * text.
 */
export async function testMcpServer(
	config: McpServerConfig,
	options: { redact?: string[]; timeoutMs?: number } = {},
): Promise<McpTestResult> {
	const started = Date.now();
	const redact = (text: string) =>
		(options.redact ?? [])
			.filter((v) => v.length >= 4)
			.reduce((t, v) => t.replaceAll(v, "•••"), text);
	try {
		return await withMcpClient(
			config,
			async (client) => {
				const { tools } = await client.listTools();
				const version = client.getServerVersion();
				return {
					ok: true,
					server: version
						? { name: version.name, version: version.version }
						: null,
					tools: tools.map(toolInfo),
					error: null,
					ms: Date.now() - started,
				};
			},
			{ timeoutMs: options.timeoutMs },
		);
	} catch (error) {
		return {
			ok: false,
			server: null,
			tools: [],
			error: redact(error instanceof Error ? error.message : String(error)),
			ms: Date.now() - started,
		};
	}
}
