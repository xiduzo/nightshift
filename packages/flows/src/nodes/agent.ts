import { z } from "zod";
import {
	checkNodeProfile,
	isObjectSchema,
	jsonSchemaSchema,
	type NodeCheck,
	nameSchema,
	nodeBase,
	nodeProfileSchema,
	placed,
} from "./base";
import { checkOptions, option } from "./outcomes";

/**
 * The Agent node: a coding-agent session on a harness, with its model,
 * tools and connections. Also the harness names, which Agent Profiles and
 * custom agents use too.
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

export const agentNodeSchema = z.object({
	...nodeBase,
	...placed,
	type: z.literal("agent"),
	/** The message to the agent. Supports templates. */
	prompt: z.string(),
	/** A skill the harness already has, run as `/<skill> <prompt>`. */
	skill: z.string().min(1).optional(),
	/**
	 * An Agent Profile of one Device (the Agents page), by the Device's id
	 * and the profile's id: its harness, model, effort, permission mode, CLI
	 * tools and connections. The step runs on that Device, so a node with a
	 * profile names no `device`. A field the node sets itself wins over the
	 * profile; CLI tools and connections add up. A run resolves the profile
	 * when it starts, and a flow that names a profile its Device does not
	 * have refuses to start.
	 */
	profile: nodeProfileSchema.optional(),
	/**
	 * The coding-agent CLI that runs the session. Each uses its own login.
	 * Required without a profile. A custom agent is `acp:<slug>`.
	 */
	harness: agentHarnessSchema.optional(),
	/** Required without a profile. */
	model: z.string().min(1).optional(),
	effort: effortSchema.optional(),
	/** Required without a profile. */
	permissionMode: permissionModeSchema.optional(),
	/**
	 * `fresh`: every visit starts a new harness session (the script's retry
	 * policy). `resume`: a later visit continues this node's last session.
	 */
	session: z.enum(["fresh", "resume"]).default("fresh"),
	/**
	 * CLI tools by name: programs on this computer the agent may run without
	 * a prompt, for example `gh` or `aws`. One defined under Agents → Tools
	 * brings its login and its notes for the agent; any other only needs to
	 * be on this computer. A flow that names one this computer cannot find
	 * refuses to start.
	 */
	clis: z.array(cliNameSchema).optional(),
	/** The step fails when the agent shows no activity for this long. */
	idleMinutes: z.number().int().positive().optional(),
	/**
	 * Connections by name: MCP servers defined once on this daemon (the
	 * Connections page), added to the harness's own configuration. A flow
	 * that names a connection the daemon does not have refuses to start.
	 */
	connections: z.array(nameSchema).optional(),
	/**
	 * The agent's own outcomes, each with an edge. Replaces `pass`, `fail`
	 * and `needs-input` when set. The agent reports one of them.
	 */
	outcomes: z.array(option).min(1).optional(),
	/**
	 * `person`: when the agent needs input, Night Shift asks a person in a
	 * Gate with its summary and questions, and takes no edge. "Answer" sends
	 * the person's note to the same session, which goes on; "Stop" ends the
	 * step `fail`. The agent may report `needs-input` even with its own
	 * outcomes. Unset: `needs-input` is an outcome like any other.
	 */
	ask: z.enum(["person"]).optional(),
	/**
	 * A JSON Schema for the `data` of the step report. The agent must report
	 * data that matches it, else the step ends as `error`. Later nodes read
	 * it as `{{<node>.data}}` or a path into it, for example `{{planner.data.tasks}}`.
	 */
	output: jsonSchemaSchema.optional(),
});
export type AgentNode = z.infer<typeof agentNodeSchema>;

/**
 * output: the final message. summary: the report's summary, else the
 * output. data: the report's JSON. note: the person's latest answer when
 * the agent asked (`ask`), or why they stopped it.
 */
export const agentOutputFields = [
	"outcome",
	"output",
	"summary",
	"data",
	"note",
	"visit",
	"session_id",
] as const;

/**
 * An Agent node needs a prompt or a skill, and a profile or its own
 * harness, model and permission mode. Its own outcomes follow the outcome
 * rules (`checkOptions`), and its output schema describes an object.
 */
export function checkAgentNode(node: AgentNode, check: NodeCheck): void {
	if (node.prompt.trim() === "" && node.skill === undefined) {
		check.error(`Agent node "${node.id}" needs a prompt or a skill.`);
	}
	if (node.profile === undefined) {
		const unset = [
			node.harness === undefined ? "harness" : null,
			node.model === undefined ? "model" : null,
			node.permissionMode === undefined ? "permission mode" : null,
		].filter((x) => x !== null);
		if (unset.length > 0) {
			const list =
				unset.length === 1
					? unset[0]
					: `${unset.slice(0, -1).join(", ")} and ${unset.at(-1)}`;
			check.error(
				`Agent node "${node.id}" needs a profile, or its own ${list}.`,
			);
		}
	}
	checkNodeProfile(node, "Agent", check);
	check.template(node.prompt, "prompt");
	if (node.outcomes !== undefined) {
		checkOptions(
			node.id,
			node.outcomes.map((o) => o.name),
			{ title: "Agent", kind: "outcome", picker: "the agent reports" },
			// An agent that reports fail or needs-input fails anyway: no surprise.
			(name) => name === "fail" || name === "needs-input",
			check,
		);
	}
	if (node.output !== undefined && !isObjectSchema(node.output)) {
		check.error(
			`The output schema of agent node "${node.id}" must describe an object: give it "type": "object" or "properties".`,
		);
	}
}
