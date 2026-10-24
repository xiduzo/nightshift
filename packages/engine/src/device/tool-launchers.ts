import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
	chmod,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { shellQuoteAlways } from "@nightshift/agents";
import type { Login } from "@nightshift/flows";

import {
	type CliTool,
	type CliToolStore,
	programOf,
	type SecretEnv,
} from "../device-config";
import { redactText } from "./redact";

/**
 * The CLI tools of one step, with their logins. A tool that runs another
 * program, or that has a login, gets a launcher: a small script named
 * after the tool, in a folder for this step only, that runs the program
 * with the tool's variables. The agent's shell finds that folder first.
 * So `gh-work` and `gh` run one program as two accounts, and the agent's
 * own environment holds no token.
 *
 * A login with a folder of its own keeps it in `<data dir>/tools/<name>`.
 * Its sign-in command runs there before the first step, and again when a
 * value it reads changes. A tool with a git host makes git there ask the
 * tool, through `GIT_CONFIG_COUNT`: no file changes.
 *
 * The variables that logins read are the guarded ones: no agent or
 * command gets them from Night Shift's own environment. A Command node
 * that names one in `secrets` still gets it.
 */

/** `${NAME}`: an environment variable name, as a shell would read it. */
const REFERENCE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/** A sign-in that does not finish in this time is stopped. */
const SIGN_IN_TIMEOUT_MS = 120_000;

/** The file in a login's folder that says which values it signed in with. */
const SIGNED_IN_FILE = ".nightshift-sign-in";

/** The CLI tools of one step, ready to run. */
export type PreparedTools = {
	/** The folder of the launchers. Null: no tool of the step needs one. */
	toolsPath: string | null;
	/** For the harness and its commands: git's settings for the tools' hosts. */
	env: Record<string, string>;
	/** The secret values the tools read, to take out of the step's record. */
	values: string[];
	/** Removes the launchers. Always call it when the step ends. */
	cleanup: () => Promise<void>;
};

export type SignInResult = {
	ok: boolean;
	/** What the sign-in command printed, with each secret value as `•••`. */
	output: string;
	/** When it signed in (epoch ms). Null: it did not. */
	signedInAt: number | null;
};

export type ToolLaunchers = {
	/**
	 * Prepares the CLI tools a step names: signs a login in where it must,
	 * and writes the launchers. `message` says what to fix when one cannot
	 * run: a program this computer does not have, a secret that is not saved.
	 */
	prepare(
		names: readonly string[],
	): Promise<({ ok: true } & PreparedTools) | { ok: false; message: string }>;
	/** Signs a tool's login in now, with its folder. */
	signIn(name: string): Promise<SignInResult>;
	/** When the tool last signed in, or null. */
	signedInAt(name: string): Promise<number | null>;
	/** Removes a tool's folder, after the tool is removed. */
	forget(name: string): Promise<void>;
	/** The variables that logins read: no agent or command inherits them. */
	guarded(): string[];
};

/** The `${NAME}` references of a login: its variables and its sign-in input. */
export function loginReferences(login: Login): string[] {
	const names = new Set<string>();
	for (const value of [
		...Object.values(login.env),
		login.signIn?.input ?? "",
	]) {
		for (const match of value.matchAll(REFERENCE)) {
			if (match[1]) names.add(match[1]);
		}
	}
	return [...names];
}

const expand = (value: string, secrets: Record<string, string>) =>
	value.replace(REFERENCE, (_, name: string) => secrets[name] ?? "");

export function createToolLaunchers(options: {
	tools: Pick<CliToolStore, "get" | "list">;
	/** Secrets by name: the saved ones, then the environment. */
	secretEnv: (names: readonly string[]) => Promise<SecretEnv>;
	/** Night Shift's data folder: the logins' own folders go in `tools/`. */
	dataDir: string;
	/** Where a program is on this computer, or null. Default: `Bun.which`. */
	which?: (program: string) => string | null;
	/** What a sign-in starts from, before the guarded variables go. */
	env?: Readonly<Record<string, string | undefined>>;
	/** Where the launcher folders go. Default: the system's temp folder. */
	tempDir?: string;
	now?: () => number;
}): ToolLaunchers {
	const {
		tools,
		secretEnv,
		dataDir,
		which = (program: string) => Bun.which(program),
		env = process.env,
		now = Date.now,
	} = options;
	const folderOf = (name: string) => join(dataDir, "tools", name);
	/** One sign-in at a time per tool: steps that start together wait for it. */
	const signingIn = new Map<string, Promise<SignInResult>>();

	function guarded(): string[] {
		const names = new Set<string>();
		for (const tool of tools.list()) {
			for (const name of tool.login ? loginReferences(tool.login) : []) {
				names.add(name);
			}
		}
		return [...names].sort();
	}

	/** The tool's login with its secrets read: its variables, its folder, its sign-in input. */
	async function resolveLogin(
		tool: CliTool,
		login: Login,
	): Promise<
		| {
				ok: true;
				env: Record<string, string>;
				input: string | undefined;
				values: string[];
		  }
		| { ok: false; message: string }
	> {
		const found = await secretEnv(loginReferences(login));
		if (!found.ok) {
			const [noun, isNot, it] =
				found.missing.length === 1
					? ["secret", "it is", "it"]
					: ["secrets", "they are", "them"];
			return {
				ok: false,
				message: `The CLI tool ${tool.name} needs the ${noun} ${found.missing.join(", ")}, but ${isNot} not saved. Save ${it} under Agents → Secrets, or change the tool's login.`,
			};
		}
		const out: Record<string, string> = Object.fromEntries(
			Object.entries(login.env).map(([key, value]) => [
				key,
				expand(value, found.env),
			]),
		);
		if (login.folder) {
			const folder = folderOf(tool.name);
			await mkdir(folder, { recursive: true, mode: 0o700 });
			await chmod(folder, 0o700);
			out[login.folder] = folder;
		}
		return {
			ok: true,
			env: out,
			input:
				login.signIn?.input === undefined
					? undefined
					: expand(login.signIn.input, found.env),
			values: Object.values(found.env).filter((value) => value !== ""),
		};
	}

	/** What a sign-in reads: when it changes, the login signs in again. */
	const fingerprint = (
		login: Login,
		resolved: { env: Record<string, string>; input: string | undefined },
	) =>
		createHash("sha256")
			.update(
				JSON.stringify({
					command: login.signIn?.command,
					input: resolved.input,
					env: resolved.env,
				}),
			)
			.digest("hex");

	async function readSignedIn(
		name: string,
	): Promise<{ fingerprint: string; at: number } | null> {
		try {
			const parsed: unknown = JSON.parse(
				await readFile(join(folderOf(name), SIGNED_IN_FILE), "utf8"),
			);
			if (
				typeof parsed === "object" &&
				parsed !== null &&
				"fingerprint" in parsed &&
				"at" in parsed &&
				typeof parsed.fingerprint === "string" &&
				typeof parsed.at === "number"
			) {
				return { fingerprint: parsed.fingerprint, at: parsed.at };
			}
		} catch {
			// Not signed in yet.
		}
		return null;
	}

	/** Runs the sign-in command in the login's folder, with its input on stdin. */
	async function runSignIn(
		tool: CliTool,
		login: Login & { signIn: NonNullable<Login["signIn"]> },
		resolved: {
			env: Record<string, string>;
			input: string | undefined;
			values: string[];
		},
	): Promise<SignInResult> {
		const program = which(programOf(tool));
		const base: Record<string, string> = {};
		const hidden = new Set(guarded());
		for (const [key, value] of Object.entries(env)) {
			if (value !== undefined && !hidden.has(key)) base[key] = value;
		}
		const folder = folderOf(tool.name);
		const { code, output } = await new Promise<{
			code: number | null;
			output: string;
		}>((resolve) => {
			let output = "";
			const child = spawn("sh", ["-c", login.signIn.command], {
				cwd: folder,
				env: {
					...base,
					...resolved.env,
					// The command finds the program the launcher runs.
					...(program
						? {
								PATH: [dirname(program), resolved.env.PATH ?? base.PATH ?? ""]
									.filter(Boolean)
									.join(delimiter),
							}
						: {}),
				},
				stdio: ["pipe", "pipe", "pipe"],
			});
			const timer = setTimeout(() => child.kill("SIGKILL"), SIGN_IN_TIMEOUT_MS);
			child.stdout.setEncoding("utf8");
			child.stderr.setEncoding("utf8");
			child.stdout.on("data", (text: string) => {
				output += text;
			});
			child.stderr.on("data", (text: string) => {
				output += text;
			});
			child.stdin.on("error", () => {});
			child.stdin.end(resolved.input ?? "");
			child.on("error", (error) => {
				clearTimeout(timer);
				resolve({ code: null, output: `${output}${error.message}` });
			});
			child.on("close", (code) => {
				clearTimeout(timer);
				resolve({ code, output });
			});
		});
		const shown = redactText(output.trim(), resolved.values);
		if (code !== 0) return { ok: false, output: shown, signedInAt: null };
		const at = now();
		await writeFile(
			join(folder, SIGNED_IN_FILE),
			JSON.stringify({ fingerprint: fingerprint(login, resolved), at }),
			{ mode: 0o600 },
		);
		return { ok: true, output: shown, signedInAt: at };
	}

	/** Signs the tool in when it must (or `force`), one sign-in at a time. */
	function ensureSignedIn(
		tool: CliTool,
		login: Login,
		resolved: {
			env: Record<string, string>;
			input: string | undefined;
			values: string[];
		},
		force: boolean,
	): Promise<SignInResult> {
		const running = signingIn.get(tool.name);
		if (running) return running;
		const signIn = login.signIn;
		const done = (async (): Promise<SignInResult> => {
			if (!signIn) return { ok: true, output: "", signedInAt: null };
			const last = await readSignedIn(tool.name);
			if (!force && last?.fingerprint === fingerprint(login, resolved)) {
				return { ok: true, output: "", signedInAt: last.at };
			}
			return runSignIn(tool, { ...login, signIn }, resolved);
		})().finally(() => signingIn.delete(tool.name));
		signingIn.set(tool.name, done);
		return done;
	}

	/** The launcher script of a tool: its variables, then the program. */
	const launcher = (
		tool: CliTool,
		path: string,
		vars: Record<string, string>,
	) =>
		[
			"#!/bin/sh",
			`# ${tool.name}: ${programOf(tool)} with its own login. Night Shift removes this folder when the step ends.`,
			...Object.entries(vars).map(
				([key, value]) => `${key}=${shellQuoteAlways(value)}; export ${key}`,
			),
			`exec ${shellQuoteAlways(path)} "$@"`,
			"",
		].join("\n");

	return {
		guarded,
		async prepare(names) {
			const launchers: {
				tool: CliTool;
				path: string;
				env: Record<string, string>;
			}[] = [];
			const git = new Map<string, { tool: string; helper: string }>();
			const values: string[] = [];
			for (const name of new Set(names)) {
				const tool = tools.get(name);
				if (!tool) continue;
				const needsLauncher = tool.login !== null || tool.program !== null;
				if (!needsLauncher && tool.git === null) continue;
				const program = programOf(tool);
				const path = which(program);
				if (path === null) {
					return {
						ok: false,
						message: `The CLI tool ${tool.name} runs ${program}, but this computer does not have it. Install ${program}, or change the tool.`,
					};
				}
				let vars: Record<string, string> = {};
				if (tool.login) {
					const resolved = await resolveLogin(tool, tool.login);
					if (!resolved.ok) return resolved;
					const signedIn = await ensureSignedIn(
						tool,
						tool.login,
						resolved,
						false,
					);
					if (!signedIn.ok) {
						return {
							ok: false,
							message: `The CLI tool ${tool.name} could not sign in. ${signedIn.output || "Its sign-in command failed."} Check its login under Agents → Tools, then start the run again.`,
						};
					}
					vars = resolved.env;
					values.push(...resolved.values);
				}
				if (needsLauncher) launchers.push({ tool, path, env: vars });
				if (tool.git) {
					const other = git.get(tool.git.host);
					if (other) {
						return {
							ok: false,
							message: `Two CLI tools of this step sign in to git on ${tool.git.host}: ${other.tool} and ${tool.name}. Take the git host off one of them.`,
						};
					}
					git.set(tool.git.host, { tool: tool.name, helper: tool.git.helper });
				}
			}
			if (launchers.length === 0 && git.size === 0) {
				return {
					ok: true,
					toolsPath: null,
					env: {},
					values: [],
					cleanup: async () => {},
				};
			}
			const folder =
				launchers.length > 0
					? await mkdtemp(
							join(options.tempDir ?? tmpdir(), "nightshift-tools-"),
						)
					: null;
			const cleanup = async () => {
				if (folder) await rm(folder, { recursive: true, force: true });
			};
			try {
				if (folder) {
					await chmod(folder, 0o700);
					for (const { tool, path, env: vars } of launchers) {
						const file = join(folder, tool.name);
						await writeFile(file, launcher(tool, path, vars), { mode: 0o700 });
						await chmod(file, 0o700);
					}
				}
				return {
					ok: true,
					toolsPath: folder,
					env: gitEnv(
						git,
						(name) => {
							const tool = tools.get(name);
							if (folder && tool && (tool.login || tool.program)) {
								return join(folder, name);
							}
							return tool ? (which(programOf(tool)) ?? programOf(tool)) : name;
						},
						env,
					),
					values: [...new Set(values)],
					cleanup,
				};
			} catch (error) {
				await cleanup();
				throw error;
			}
		},
		async signIn(name) {
			const tool = tools.get(name);
			if (!tool?.login?.signIn) {
				return {
					ok: false,
					output: `The CLI tool ${name} has no sign-in command.`,
					signedInAt: null,
				};
			}
			const resolved = await resolveLogin(tool, tool.login);
			if (!resolved.ok) {
				return { ok: false, output: resolved.message, signedInAt: null };
			}
			return ensureSignedIn(tool, tool.login, resolved, true);
		},
		async signedInAt(name) {
			return (await readSignedIn(name))?.at ?? null;
		},
		async forget(name) {
			await rm(folderOf(name), { recursive: true, force: true });
		},
	};
}

/**
 * Git's settings for the step's hosts, as `GIT_CONFIG_*` variables after
 * the ones Night Shift's environment has: per host, an empty helper (git
 * then forgets the helpers of its files for that host), then the tool's.
 */
export function gitEnv(
	hosts: ReadonlyMap<string, { tool: string; helper: string }>,
	commandOf: (tool: string) => string,
	base: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
	if (hosts.size === 0) return {};
	const start = Number.parseInt(base.GIT_CONFIG_COUNT ?? "0", 10);
	let index = Number.isFinite(start) && start > 0 ? start : 0;
	const out: Record<string, string> = {};
	const add = (key: string, value: string) => {
		out[`GIT_CONFIG_KEY_${index}`] = key;
		out[`GIT_CONFIG_VALUE_${index}`] = value;
		index += 1;
	};
	for (const [host, { tool, helper }] of hosts) {
		const key = `credential.https://${host}.helper`;
		add(key, "");
		add(key, `!${shellQuoteAlways(commandOf(tool))} ${helper}`);
	}
	out.GIT_CONFIG_COUNT = String(index);
	return out;
}
