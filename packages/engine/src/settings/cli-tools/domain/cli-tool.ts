import { cliNameSchema, type Login, loginSchema } from "@nightshift/flows";
import { z } from "zod";

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

/** A CLI tool as the Device document holds it, under its name. */
export type CliToolEntry = Omit<CliTool, "name">;

/** The program a CLI tool runs. */
export const programOf = (tool: Pick<CliTool, "name" | "program">): string =>
	tool.program ?? tool.name;

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

/** The CLI tools of a Device document's `cliTools` map, by name. */
export function readCliTools(
	entries: Iterable<[string, unknown]>,
): Map<string, CliTool> {
	const out = new Map<string, CliTool>();
	for (const [name, value] of entries) {
		const entry = entrySchema.safeParse(value);
		if (!entry.success || !cliNameSchema.safeParse(name).success) continue;
		out.set(name, { name, ...entry.data });
	}
	return out;
}

/** A login that does nothing reads as none. */
function loginOrNull(login: Login | undefined): Login | null {
	if (!login) return null;
	const empty =
		Object.keys(login.env).length === 0 &&
		login.folder === undefined &&
		login.signIn === undefined;
	return empty ? null : login;
}

/**
 * The CLI tool a save of `input` makes. A program of the tool's own name
 * is saved as none. It reads the clock after the input parses.
 */
export function cliToolSave(input: CliToolInput, now: () => number): CliTool {
	const parsed = cliToolInputSchema.parse(input);
	return {
		name: parsed.name,
		program:
			parsed.program && parsed.program !== parsed.name ? parsed.program : null,
		description: parsed.description || null,
		login: loginOrNull(parsed.login),
		git: parsed.git ?? null,
		updatedAt: now(),
	};
}
