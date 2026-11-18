import { z } from "zod";

/**
 * What an Agent runs on: the harness names, a custom agent, a CLI tool and
 * its login, an MCP server, and the effort and permission mode of a
 * session. Agent nodes, Agent Profiles and the settings of a computer
 * name them.
 */

/**
 * A CLI tool: the name of a program on this computer, as a shell finds it
 * on its PATH, for example `gh`, `aws` or `acli`. Defined once on the daemon
 * (the Agents page, under Tools); an Agent node or profile lists the ones its
 * agent may run.
 */
export const cliNameSchema = z
	.string()
	.regex(
		/^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/,
		"Use the program name only, for example gh or aws.",
	);

/**
 * The coding-agent CLIs an Agent node can run on. The first four have their
 * own TanStack AI harness adapter; the others speak the Agent Client
 * Protocol and run through `@tanstack/ai-acp`.
 */
export const harnessNameSchema = z.enum([
	"claude-code",
	"opencode",
	"codex",
	"grok-build",
	"copilot",
	"gemini",
	"cursor",
	"pi",
]);
export type HarnessName = z.infer<typeof harnessNameSchema>;

/** A custom agent's slug: its name in a flow, after `acp:`. */
export const customAgentSlugSchema = z
	.string()
	.regex(
		/^[a-z0-9][a-z0-9-]{0,39}$/,
		"Use lowercase letters, digits and -, for example goose.",
	);

/**
 * A custom agent in a flow: `acp:` and its slug, for example `acp:goose`.
 * Any coding agent that speaks the Agent Client Protocol, added by the
 * person with its command (`customAgentSchema`). A flow that names one
 * still validates on a computer without it: a run there refuses the node,
 * as for a built-in harness that is not added.
 */
export const customHarnessSchema = z.templateLiteral([
	"acp:",
	customAgentSlugSchema,
]);
export type CustomHarnessName = z.infer<typeof customHarnessSchema>;

/** What an Agent node or an Agent Profile runs on: a built-in harness or a custom agent. */
export const agentHarnessSchema = z.union([
	harnessNameSchema,
	customHarnessSchema,
]);
export type AgentHarnessName = z.infer<typeof agentHarnessSchema>;

export const isCustomHarness = (name: string): name is CustomHarnessName =>
	name.startsWith("acp:");

/** The flow name of the custom agent with this slug. */
export const customHarnessName = (slug: string): CustomHarnessName =>
	`acp:${slug}`;

/** The slug of a custom agent's flow name. */
export const customAgentSlug = (name: CustomHarnessName): string =>
	name.slice("acp:".length);

/** An environment variable name, as a shell reads it. */
const envNameSchema = z
	.string()
	.regex(
		/^[A-Za-z_][A-Za-z0-9_]{0,127}$/,
		"Use letters, digits and _, starting with a letter or _.",
	);

/**
 * A custom agent: a coding agent that speaks the Agent Client Protocol on
 * stdio, started with `command` and `args` (for example `goose acp`).
 * Saved in the daemon's settings, never in a flow file. `${NAME}` in an
 * `env` value reads a secret when a session starts.
 */
export const customAgentSchema = z.object({
	slug: customAgentSlugSchema,
	label: z.string().trim().min(1).max(64),
	command: z.string().trim().min(1),
	args: z.array(z.string()).max(64).default([]),
	env: z.record(envNameSchema, z.string()).default({}),
});
export type CustomAgent = z.infer<typeof customAgentSchema>;

/**
 * A login: how a program signs in, so that one computer can hold several
 * accounts of one program. Set on the computer only (a CLI tool), never in
 * a flow file: a flow names the tool, not its secrets. `${NAME}` in a value
 * reads a secret when a step starts.
 */
export const loginSchema = z
	.object({
		/** Only the program gets these, for example `GH_TOKEN: "${GH_WORK_TOKEN}"`. */
		env: z.record(envNameSchema, z.string()).default({}),
		/**
		 * The variable that points the program at a folder Night Shift keeps
		 * for this login, for a program that keeps its sign-in in a file:
		 * `HOME` for acli, `GH_CONFIG_DIR` for gh.
		 */
		folder: envNameSchema.optional(),
		/**
		 * Signs the program in, in its folder: once, and again when a value
		 * it reads changes. `input` goes to its standard input, so a token is
		 * never part of the command.
		 */
		signIn: z
			.object({
				command: z.string().trim().min(1).max(2000),
				input: z.string().max(2000).optional(),
			})
			.optional(),
	})
	.refine((login) => login.signIn === undefined || login.folder !== undefined, {
		message:
			"A sign-in needs a folder of its own. Choose the variable that points the program at it, for example HOME.",
		path: ["folder"],
	});
export type Login = z.infer<typeof loginSchema>;

export const effortSchema = z.enum(["low", "medium", "high", "xhigh", "max"]);

/**
 * `auto` lets Claude Code's classifier approve safe actions, such as
 * running tests, with nobody awake. `acceptEdits` approves file edits
 * only: every shell command is refused in an unattended run.
 */
export const permissionModeSchema = z.enum([
	"default",
	"acceptEdits",
	"auto",
	"bypassPermissions",
	"plan",
]);

/**
 * An MCP server: a local command (stdio) or a URL (streamable HTTP). A
 * Connection holds one, saved on the daemon, never in a flow file.
 * `${NAME}` in `env` values and `headers` reads a secret when the session
 * starts.
 */
export const mcpServerSchema = z.union([
	z.object({
		command: z.string().min(1),
		args: z.array(z.string()).default([]),
		env: z.record(z.string(), z.string()).default({}),
	}),
	z.object({
		url: z.url(),
		headers: z.record(z.string(), z.string()).default({}),
	}),
]);
export type McpServer = z.infer<typeof mcpServerSchema>;
