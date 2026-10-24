import { cliNameSchema, type Login, loginSchema } from "@nightshift/flows";
import { z } from "zod";

import { type DeviceDocument, mapView } from "./device-document";

/**
 * CLI tools: programs on this computer (`gh`, `aws`), defined once in its
 * Device document (the Agents page, under Tools). An Agent node or profile
 * lists the ones its agent may run; the harness then allows them without a
 * prompt. A run whose flow names one the daemon does not have, or one this
 * computer cannot find, refuses to start.
 *
 * A tool's name is what the agent types. It runs `program`, or the program
 * of the same name, with its `login`: so `gh-work` and `gh` can be two
 * accounts of `gh` (`tool-launchers.ts` runs them).
 */

/** A host name for git, for example `github.com`. */
const gitHostSchema = z
	.string()
	.trim()
	.toLowerCase()
	.regex(
		/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:\d{1,5})?$/,
		"Use a host name only, for example github.com.",
	);

/**
 * Git on `host` signs in with the tool, in the steps that have it: git asks
 * the tool's program `helper` (its arguments), for example `gh auth
 * git-credential`.
 */
export const cliToolGitSchema = z.object({
	host: gitHostSchema,
	helper: z.string().trim().min(1).max(200).default("auth git-credential"),
});
export type CliToolGit = z.infer<typeof cliToolGitSchema>;

export const cliToolInputSchema = z.object({
	name: cliNameSchema,
	/** The program it runs. Unset: the program of the same name. */
	program: cliNameSchema.optional(),
	description: z.string().trim().max(500).optional(),
	login: loginSchema.optional(),
	git: cliToolGitSchema.optional(),
});
export type CliToolInput = z.input<typeof cliToolInputSchema>;

export type CliTool = {
	name: string;
	/** The program it runs. Null: the program of the same name. */
	program: string | null;
	description: string | null;
	/** How the program signs in. Null: the way it does on this computer. */
	login: Login | null;
	/** The host that git signs in to with this tool. Null: none. */
	git: CliToolGit | null;
	updatedAt: number;
};

/** The program a CLI tool runs. */
export const programOf = (tool: Pick<CliTool, "name" | "program">): string =>
	tool.program ?? tool.name;

export type CliToolStore = {
	/** Reads the CLI tools. Call once before `names`. */
	load(): Promise<void>;
	/** The CLI tool names, for the start check. */
	names(): ReadonlySet<string>;
	list(): CliTool[];
	get(name: string): CliTool | null;
	/** Creates or replaces a CLI tool. */
	save(input: CliToolInput): Promise<CliTool>;
	remove(name: string): Promise<void>;
};

/**
 * A CLI tool as the Device document holds it. An older document has no
 * program, login or git; a login or git this version cannot read reads as
 * none, so the tool still runs, the way it did before it had them.
 */
const entrySchema = z.object({
	description: z.string().nullable(),
	program: cliNameSchema.nullable().catch(null).default(null),
	login: loginSchema.nullable().catch(null).default(null),
	git: cliToolGitSchema.nullable().catch(null).default(null),
	updatedAt: z.number(),
});

/** A login that does nothing reads as none. */
function loginOrNull(login: Login | undefined): Login | null {
	if (!login) return null;
	const empty =
		Object.keys(login.env).length === 0 &&
		login.folder === undefined &&
		login.signIn === undefined;
	return empty ? null : login;
}

export function createCliToolStore(options: {
	document: DeviceDocument;
}): CliToolStore {
	const { document } = options;
	const tools = mapView(document, document.cliTools, () => {
		const out = new Map<string, CliTool>();
		for (const [name, value] of document.cliTools.entries()) {
			const entry = entrySchema.safeParse(value);
			if (!entry.success || !cliNameSchema.safeParse(name).success) continue;
			out.set(name, { name, ...entry.data });
		}
		return out;
	});

	return {
		// The document is read when it opens; a remote edit applies at once.
		async load() {},
		names: () => new Set(tools().keys()),
		list: () =>
			[...tools().values()].sort((a, b) => a.name.localeCompare(b.name)),
		get: (name) => tools().get(name) ?? null,
		async save(input) {
			const parsed = cliToolInputSchema.parse(input);
			const saved: CliTool = {
				name: parsed.name,
				program:
					parsed.program && parsed.program !== parsed.name
						? parsed.program
						: null,
				description: parsed.description || null,
				login: loginOrNull(parsed.login),
				git: parsed.git ?? null,
				updatedAt: Date.now(),
			};
			await document.change(() => {
				document.cliTools.set(parsed.name, {
					description: saved.description,
					program: saved.program,
					login: saved.login,
					git: saved.git,
					updatedAt: saved.updatedAt,
				});
			});
			return saved;
		},
		async remove(name) {
			await document.change(() => {
				document.cliTools.delete(name);
			});
		},
	};
}

/** What an agent learns about one of its CLI tools when its session starts. */
export type CliToolGuide = {
	name: string;
	/** The program it runs, when that is not its name. */
	program?: string;
	/** It has a login of its own: a separate account. */
	login?: boolean;
	description: string | null;
	/** The program's own help (`--help`). Null when it has none. */
	help: string | null;
};

/**
 * The prompt section that tells an agent which CLI tools it has: each
 * name, the description its owner wrote, and the program's help. The help
 * is quoted in a fence longer than any backtick run inside it.
 */
export function cliToolsInstruction(tools: readonly CliToolGuide[]): string {
	if (tools.length === 0) return "";
	const sections = tools.map((tool) => {
		const lines = [`### ${tool.name}`];
		if (tool.description) lines.push("", tool.description);
		if (tool.program && tool.program !== tool.name) {
			lines.push(
				"",
				`\`${tool.name}\` runs \`${tool.program}\`${tool.login ? " with its own login" : ""}. Type \`${tool.name}\` where you would type \`${tool.program}\`.`,
			);
		}
		if (tool.help) {
			const longest = Math.max(
				0,
				...(tool.help.match(/`+/g) ?? []).map((run) => run.length),
			);
			const fence = "`".repeat(Math.max(3, longest + 1));
			lines.push(
				"",
				`\`${tool.name} --help\`:`,
				"",
				`${fence}text`,
				tool.help,
				fence,
			);
		}
		return lines.join("\n");
	});
	return [
		"## CLI tools",
		"",
		"You can run these programs in your shell. Use them instead of guessing at an API. For the details of one command, run it with `--help`.",
		"",
		sections.join("\n\n"),
	].join("\n");
}
