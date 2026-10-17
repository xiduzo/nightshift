import { z } from "zod";

/**
 * The flow file format: `.nightshift/flows/<name>.json` in the user's clone.
 * The schema checks shape only. `validateFlow` checks meaning (unbounded
 * loops, unknown names, template references, calls between flows).
 *
 * A flow is a function: it declares `inputs`, runs its nodes, and returns
 * `outputs` to whoever called it (a run, a Subflow node, or a For Each node).
 * Older files migrate on load (`migrateFlow`).
 */

export const FLOW_VERSION = 3;

/**
 * A node id or an input name. Both are names in templates (`{{check.log_tail}}`,
 * `{{epic}}`) and share one namespace per flow. `run` is reserved.
 */
export const nameSchema = z
	.string()
	.regex(
		/^[a-z][a-z0-9_]{0,39}$/,
		"Use lowercase letters, digits and _, starting with a letter.",
	);
export const nodeIdSchema = nameSchema;

/** A flow file name, without `.json`. */
export const flowNameSchema = z
	.string()
	.regex(
		/^[a-z0-9][a-z0-9-]{0,59}$/,
		"Use lowercase letters, digits and -, starting with a letter or digit.",
	);

/**
 * An outcome: `pass`, `fail`, `needs-input`, an Agent's own outcome, or a
 * Decision option. "error", "stopped", "interrupted" and "waiting" are
 * reserved for the engine.
 */
export const labelSchema = z
	.string()
	.regex(
		/^[a-z][a-z0-9-]{0,29}$/,
		"Use lowercase letters, digits and -, starting with a letter.",
	);

export const reservedOutcomes = [
	"error",
	"stopped",
	"interrupted",
	"waiting",
] as const;

/** Names a flow may not use for a node or an input. */
export const reservedNames = ["run"] as const;

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
]);
export type HarnessName = z.infer<typeof harnessNameSchema>;

/**
 * Who decides a Decision node: a TanStack AI decision model, through
 * `decide()`. TypeSafe and OpenRouter serve Jev, OpenAI its Decisions API,
 * Ollaya a `laya` model on this computer.
 */
export const deciderNameSchema = z.enum([
	"typesafe",
	"openrouter",
	"openai",
	"ollaya",
]);
export type DeciderName = z.infer<typeof deciderNameSchema>;

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

const option = z.object({
	name: labelSchema,
	/** Tells the agent, the model or the person what this option means. */
	description: z.string().optional(),
	/**
	 * Decision nodes decided by a rule only: a JSONata expression over the
	 * run's values (`build.data.tests_passed = true and check.exit_code = 0`).
	 * The first option whose rule holds is the outcome. An option without a
	 * rule is the default: at most one, and it goes last.
	 */
	when: z.string().optional(),
});
export type Option = z.infer<typeof option>;

/** Who decides a Decision node: you (a Gate), a rule, or a model. */
export const decidedBySchema = z.enum(["person", "rule", "model"]);
export type DecidedBy = z.infer<typeof decidedBySchema>;

/**
 * An MCP server an Agent node adds to its session: a local command (stdio)
 * or a URL (streamable HTTP). Flow files live in repos: never put secrets
 * here. `${NAME}` in `env` values and `headers` reads the daemon's
 * environment when the session starts.
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

/** A JSON Schema object (draft 2020-12 subset), kept as data. */
export const jsonSchemaSchema = z.record(z.string(), z.unknown());

const position = z.object({ x: z.number(), y: z.number() });

/** A template string per input name of the called flow. */
const bindings = z.record(nameSchema, z.string());

const nodeBase = {
	id: nodeIdSchema,
	/** Display name in the editor. Defaults to the id. */
	label: z.string().optional(),
	position,
	/** Wall-clock budget for one visit. The step fails when it runs out. */
	timeoutMinutes: z.number().int().positive().optional(),
};

export const agentNodeSchema = z.object({
	...nodeBase,
	type: z.literal("agent"),
	/** The message to the agent. Supports templates. */
	prompt: z.string(),
	/** A skill the harness already has, run as `/<skill> <prompt>`. */
	skill: z.string().min(1).optional(),
	/**
	 * An Agent Profile defined on the daemon (the Agents page): its harness,
	 * model, effort, permission mode, CLI tools and connections. A field the
	 * node sets itself wins over the profile; CLI tools and connections add
	 * up. A run resolves the profile when it starts, and a flow that names a
	 * profile the daemon does not have refuses to start.
	 */
	profile: nameSchema.optional(),
	/**
	 * The coding-agent CLI that runs the session. Each uses its own login.
	 * Required without a profile.
	 */
	harness: harnessNameSchema.optional(),
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
	 * CLI tools by name (programs defined on this daemon, under Agents →
	 * Tools): the agent may run them without a prompt. A flow that names one
	 * the daemon does not have, or that this computer cannot find, refuses
	 * to start.
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
	/** MCP servers by name, added to the harness's own configuration. */
	mcpServers: z.record(nameSchema, mcpServerSchema).optional(),
	/**
	 * The agent's own outcomes, each with an edge. Replaces `pass`, `fail`
	 * and `needs-input` when set. The agent reports one of them.
	 */
	outcomes: z.array(option).min(1).optional(),
	/**
	 * A JSON Schema for the `data` of the step report. The agent must report
	 * data that matches it, else the step ends as `error`. Later nodes read
	 * it as `{{<node>.data}}` or a path into it, for example `{{planner.data.tasks}}`.
	 */
	output: jsonSchemaSchema.optional(),
});

/**
 * What an Agent Profile sets on the nodes that name it. Defined once on the
 * daemon (the Agents page), never in a flow file.
 */
export const agentProfileSettingsSchema = z.object({
	harness: harnessNameSchema,
	model: z.string().trim().min(1),
	effort: effortSchema.optional(),
	permissionMode: permissionModeSchema,
	/** CLI tools (programs on this daemon) by name. */
	clis: z.array(cliNameSchema).default([]),
	/** Connections (MCP servers on this daemon) by name. */
	connections: z.array(nameSchema).default([]),
});
export type AgentProfileSettings = z.infer<typeof agentProfileSettingsSchema>;

export const agentProfileSchema = agentProfileSettingsSchema.extend({
	name: nameSchema,
	description: z.string().trim().max(500).optional(),
});
export type AgentProfile = z.infer<typeof agentProfileSchema>;

export const commandNodeSchema = z.object({
	...nodeBase,
	type: z.literal("command"),
	/**
	 * Run with `sh -c` in the worktree. Exit 0 is `pass`. Template values
	 * arrive as environment variables, never as shell text: write
	 * `echo "{{worker.summary}}"` and the shell sees `echo "${NS_WORKER_SUMMARY}"`.
	 */
	command: z.string().min(1),
});

/**
 * Picks one of its options, which is the step's outcome. `by` says who:
 * `person` (a Gate: the question waits in the Needs-you inbox), `rule`
 * (the first option whose `when` holds, no cost), or `model` (a small
 * model reads the prompt and picks).
 */
export const decisionNodeSchema = z.object({
	...nodeBase,
	type: z.literal("decision"),
	/**
	 * The question for a person, the brief for a model, or a note on what
	 * the rule checks. Supports templates.
	 */
	prompt: z.string(),
	/** The options to pick from. Each one is an outcome, with its own edge. */
	options: z.array(option).min(1),
	by: decidedBySchema,
	/** `by: "model"` only: the decision model that picks. */
	decider: deciderNameSchema.default("typesafe"),
	/** `by: "model"` only. The decider's model. Unset: the decider's default (`jev-latest` for TypeSafe). */
	model: z.string().min(1).optional(),
});

/**
 * Runs another flow of the project once. `inputs` binds each input of the
 * called flow to a template. Its outputs are the called flow's outputs, plus
 * `ended` (the label or choice it ended on, or "") and `visit`.
 */
export const subflowNodeSchema = z.object({
	...nodeBase,
	type: z.literal("subflow"),
	flow: flowNameSchema,
	inputs: bindings.default({}),
});

/**
 * A template that renders a JSON array, often another node's output:
 * `{{planner.data.tasks}}`. A template that is one reference keeps the
 * value as it is; any other text is parsed as JSON after rendering.
 */
export const jsonSourceSchema = z.object({
	kind: z.literal("json"),
	value: z.string().min(1),
});

/**
 * A command (sh -c in the worktree) that prints a JSON array. Template
 * values arrive as environment variables, as in a Command node. An issue
 * tracker is a command on its CLI: `gh`, `glab`, `acli`.
 */
export const commandSourceSchema = z.object({
	kind: z.literal("command"),
	command: z.string().min(1),
});

/**
 * Files in the worktree that match a glob, sorted by path. Each element is
 * `{ id: path, title: path, path }`. The glob supports templates, for
 * example `{{glob}}`, and stays inside the worktree.
 */
export const filesSourceSchema = z.object({
	kind: z.literal("files"),
	glob: z.string().min(1),
});

export const listSourceSchema = z.discriminatedUnion("kind", [
	jsonSourceSchema,
	commandSourceSchema,
	filesSourceSchema,
]);

/**
 * Runs a flow once per element of a list. An element is any JSON value. An
 * object element may carry `id` (else `name`, else its position), `title`,
 * `url`, `dependsOn` (ids, or `{ id, done }`), and `done` (true: skipped).
 */
export const forEachNodeSchema = z.object({
	...nodeBase,
	type: z.literal("foreach"),
	/** Read again before each element, so elements added during the run run too. */
	source: listSourceSchema,
	/** The flow to run per element. Any flow of the project that has the input named by `as`. */
	flow: flowNameSchema,
	/** The input of the called flow that receives the element. */
	as: nameSchema.default("item"),
	/** Templates for the called flow's other inputs, for example `{ "epic": "{{epic}}" }`. */
	inputs: bindings.default({}),
	/**
	 * `per-item`: each element works on its own branch, created on top of the
	 * last element that finished (the stack). `shared`: all elements work on
	 * the branch that is checked out.
	 */
	branch: z.enum(["per-item", "shared"]).default("per-item"),
	/** A called flow that ends on one of these options stops the loop with `halted`. */
	haltOn: z.array(labelSchema).default(["halt"]),
	/** Safety net: the most elements one visit may start. */
	maxItems: z.number().int().positive().optional(),
});

/**
 * Calls one tool of a Connection (an MCP server defined once on this
 * daemon) and gets its result, with no model in the loop. The MCP leg of
 * "flow + CLI + MCP": a Command node runs a CLI, a Tool node calls a tool.
 * The result's `isError`, a tool the server does not have, or a transport
 * failure is `fail`.
 */
export const toolNodeSchema = z.object({
	...nodeBase,
	type: z.literal("tool"),
	/** A Connection by name. A flow that names one the daemon does not have refuses to start. */
	connection: nameSchema,
	/** The tool's name, as the server lists it. */
	tool: z.string().min(1),
	/**
	 * A template per argument. A template that is one reference keeps its
	 * JSON value (`{{plan.data.tasks}}` stays an array); any other text is a
	 * string, unless the tool's input schema says number, integer, boolean,
	 * object or array: then the text is read as that.
	 */
	arguments: z.record(z.string(), z.string()).default({}),
});

export const flowNodeSchema = z.discriminatedUnion("type", [
	agentNodeSchema,
	commandNodeSchema,
	decisionNodeSchema,
	subflowNodeSchema,
	forEachNodeSchema,
	toolNodeSchema,
]);

export const outcomeSchema = labelSchema;

export const flowEdgeSchema = z.object({
	id: z.string().min(1),
	from: nodeIdSchema,
	outcome: outcomeSchema,
	to: nodeIdSchema,
	/**
	 * How often a run may take this edge. Every cycle needs at least one edge
	 * with a max. When several edges leave a node on the same outcome, the
	 * engine takes the first one (in file order) that has not hit its max.
	 */
	max: z.number().int().positive().optional(),
});

/**
 * The numbers of the run policy. The policy itself is engine code: a usage
 * limit or a network failure waits and then continues the same session.
 * Only the top-level flow of a run sets them.
 */
/**
 * The run policy of one flow. Every value is optional: a value the flow
 * leaves out comes from the daemon's settings (Settings → Run policy).
 */
export const policySchema = z.object({
	/** The first wait after a usage limit without a known reset time. Doubles each time. */
	usageLimitFirstWaitMinutes: z.number().positive().optional(),
	usageLimitMaxWaitMinutes: z.number().positive().optional(),
	/** The longest total wait for the network before the step fails. */
	networkGraceMinutes: z.number().positive().optional(),
	/** Safety net: the most steps a run may take before it stops (resumable). */
	maxSteps: z.number().int().positive().optional(),
	/**
	 * After a daemon restart, a run the daemon stopped mid-step continues on
	 * its own (true) or waits for a person (false).
	 */
	resumeInterruptedRuns: z.boolean().optional(),
});

/**
 * A value the flow takes. `text`: a string, the start dialog shows a field.
 * `json`: any JSON value, read with a path (`{{item.title}}`); the start
 * dialog takes JSON.
 */
export const flowInputSchema = z.object({
	name: nameSchema,
	type: z.enum(["text", "json"]).default("text"),
	/** Shown in the start dialog. Defaults to the name. */
	label: z.string().optional(),
	description: z.string().optional(),
	/** Used when no value is given. For `json`, JSON text. */
	default: z.string().optional(),
	/** A run or a call cannot start without a value (or a default). */
	required: z.boolean().optional(),
});

/** A value the flow returns, rendered from a template when the flow ends. */
export const flowOutputSchema = z.object({
	name: nameSchema,
	/** A template. One reference keeps its JSON value: `{{review.data}}`. */
	value: z.string(),
	description: z.string().optional(),
});

export const flowSchema = z.object({
	version: z.literal(FLOW_VERSION),
	description: z.string().optional(),
	inputs: z.array(flowInputSchema).default([]),
	outputs: z.array(flowOutputSchema).default([]),
	/** Used when this flow is the top-level flow of a run. */
	policy: policySchema.optional(),
	/** The node the flow starts at. */
	start: nodeIdSchema,
	nodes: z.array(flowNodeSchema),
	edges: z.array(flowEdgeSchema),
});

export type Flow = z.infer<typeof flowSchema>;
/** What a flow file holds before defaults apply. Write files in this shape. */
export type FlowInput = z.input<typeof flowSchema>;
export type FlowNode = z.infer<typeof flowNodeSchema>;
export type AgentNode = z.infer<typeof agentNodeSchema>;
export type CommandNode = z.infer<typeof commandNodeSchema>;
export type DecisionNode = z.infer<typeof decisionNodeSchema>;
export type SubflowNode = z.infer<typeof subflowNodeSchema>;
export type ForEachNode = z.infer<typeof forEachNodeSchema>;
export type ToolNode = z.infer<typeof toolNodeSchema>;
export type ListSource = z.infer<typeof listSourceSchema>;
export type Policy = z.infer<typeof policySchema>;
/**
 * A policy with every wait filled in: the flow's own, else the daemon's
 * setting. `maxSteps` and `resumeInterruptedRuns` stay the flow's own: the
 * engine reads the setting when it applies.
 */
export type ResolvedPolicy = Required<
	Omit<Policy, "maxSteps" | "resumeInterruptedRuns">
> &
	Pick<Policy, "maxSteps" | "resumeInterruptedRuns">;
export type FlowInputDef = z.infer<typeof flowInputSchema>;
export type FlowOutputDef = z.infer<typeof flowOutputSchema>;
export type FlowEdge = z.infer<typeof flowEdgeSchema>;
export type Outcome = z.infer<typeof outcomeSchema>;
export type FlowNodeType = FlowNode["type"];

/** Any JSON value: what inputs, outputs and list elements hold. */
export type JsonValue =
	| string
	| number
	| boolean
	| null
	| JsonValue[]
	| { [key: string]: JsonValue };

/** The outcomes a node can end with, in the order its handles show. */
export function nodeOutcomes(node: FlowNode): readonly Outcome[] {
	switch (node.type) {
		case "agent":
			return node.outcomes
				? node.outcomes.map((o) => o.name)
				: ["pass", "fail", "needs-input"];
		case "command":
			return ["pass", "fail"];
		case "decision":
			return node.options.map((option) => option.name);
		case "subflow":
			return ["pass", "fail"];
		case "foreach":
			return ["done", "halted"];
		case "tool":
			return ["pass", "fail"];
	}
}

/**
 * Why `name` is not an option of the node, or null when it is one. The one
 * check for an answer from a person, a model or a rule: the engine, the
 * Gate API and the model's `decide` tool all use it.
 */
export function optionProblem(
	options: readonly Pick<Option, "name">[],
	name: string,
): string | null {
	const names = options.map((option) => option.name);
	if (names.includes(name)) return null;
	return `"${name}" is not an option of this node. Choose one of: ${names.join(", ")}.`;
}

/**
 * The fields a later node can read with `{{<nodeId>.<field>}}`. A field of a
 * node that has not run yet renders as an empty string. `data` (Agent) and
 * `results` (For Each) hold JSON and take a deeper path. A Subflow node also
 * has the outputs of the flow it calls (see `nodeOutputFields`).
 */
export const outputFieldsByType = {
	/** output: the final message. summary: the report's summary, else the output. data: the report's JSON. */
	agent: ["outcome", "output", "summary", "data", "visit", "session_id"],
	/** log_tail: the last lines of stdout and stderr together. */
	command: ["outcome", "exit_code", "log_tail", "visit"],
	/** outcome: the option. note: what the person wrote, or why the model picked it. */
	decision: ["outcome", "note", "visit"],
	/** ended: the label or choice the called flow ended on, or "". */
	subflow: ["outcome", "ended", "visit"],
	/**
	 * Counts per element state; summary: one line per element; results: a JSON
	 * array of `{ id, title, state, reason, outputs }` per element.
	 */
	foreach: [
		"outcome",
		"done_count",
		"failed_count",
		"blocked_count",
		"waiting_count",
		"summary",
		"results",
		"visit",
	],
	/**
	 * data: the tool's structured content, else the JSON its text holds, else
	 * null. text: the text content, joined.
	 */
	tool: ["outcome", "data", "text", "visit"],
} as const satisfies Record<FlowNodeType, readonly string[]>;

/** Output fields that hold JSON, so a template may take a path below them. */
export const jsonOutputFields = ["data", "results"] as const;

/**
 * Fields of the run: `{{run.branch}}`. Inside a For Each, `branch` is the
 * element's branch, `base_branch` the branch it builds on, and `index` the
 * element's position (from 0). Outside, both are "".
 */
export const runFields = [
	"branch",
	"base_branch",
	"index",
	"worktree",
	"base_ref",
	"flow",
] as const;
export type RunField = (typeof runFields)[number];

/**
 * The fields a later node can read from `node`: `outputFieldsByType`, plus
 * for a Subflow node the output names of the flow it calls, when known.
 */
export function nodeOutputFields(
	node: FlowNode,
	called?: Flow | null,
): readonly string[] {
	const fields: readonly string[] = outputFieldsByType[node.type];
	if (node.type !== "subflow" || !called) return fields;
	const outputs = called.outputs
		.map((output) => output.name)
		.filter((name) => !fields.includes(name));
	return [...fields, ...outputs];
}
