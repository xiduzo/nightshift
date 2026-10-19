import { z } from "zod";

/**
 * The flow file format: `.nightshift/flows/<name>.json` in the user's clone.
 * The schema checks shape only. `validateFlow` checks meaning (unbounded
 * loops, unknown names, template references, calls between flows).
 *
 * A flow is a function: it declares `inputs`, runs its nodes, and returns
 * `outputs` to whoever called it (a run, or a Call node). Older files
 * migrate on load (`migrateFlow`).
 */

export const FLOW_VERSION = 4;

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

/**
 * The deciders that can also make a value (a Value node made by a model):
 * those with a TanStack AI text adapter, so `chat()` can hold their answer
 * to a JSON Schema. TypeSafe and Ollaya are decision models only: they
 * answer choice, score and yes/no questions, never with data.
 */
export const valueDeciderNameSchema = z.enum(["openrouter", "openai"]);
export type ValueDeciderName = z.infer<typeof valueDeciderNameSchema>;

/** Whether the decider can make a value. */
export function canMakeValue(name: DeciderName): name is ValueDeciderName {
	return valueDeciderNameSchema.safeParse(name).success;
}

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

/**
 * A Device by the name its owner gave it ("MacBook", "hetzner-1"). A node
 * that names one runs there (its Placement); a run refuses to start when
 * the Person who starts it has no Device of that name.
 */
export const deviceNameSchema = z.string().trim().min(1).max(64);

/** Where the node's step runs. Unset: the profile's Device, else the run's. */
const placed = { device: deviceNameSchema.optional() };

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
	...placed,
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
	 * CLI tools for this node only: programs this computer has that are not
	 * defined on the daemon. The agent may run them without a prompt. A flow
	 * that names one this computer cannot find refuses to start.
	 */
	nodeClis: z.array(cliNameSchema).optional(),
	/**
	 * The agent's own outcomes, each with an edge. Replaces `pass`, `fail`
	 * and `needs-input` when set. The agent reports one of them, or with a
	 * `checker` the checker picks one.
	 */
	outcomes: z.array(option).min(1).optional(),
	/**
	 * Who picks the outcome. Unset: the agent itself, in its step report,
	 * from the outcomes only. Set: the agent reports its summary and data,
	 * then this decision model reads them and picks the outcome.
	 */
	checker: z
		.object({
			decider: deciderNameSchema.default("typesafe"),
			/** Unset: the decider's default model. */
			model: z.string().min(1).optional(),
			/** What the checker looks for. Supports templates. */
			prompt: z.string().optional(),
		})
		.optional(),
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

/**
 * One exit of a Command node: an exit code and the outcome it ends with.
 * The exit without a `code` is the catch-all: any other code, a command
 * that cannot start, and JSON output that is not valid. At most one, last.
 */
export const commandExitSchema = z.object({
	name: labelSchema,
	code: z.number().int().min(0).max(255).optional(),
	description: z.string().optional(),
});
export type CommandExit = z.infer<typeof commandExitSchema>;

/** The exits of a Command node that does not list its own: today's pass and fail. */
export const LEGACY_COMMAND_EXITS: CommandExit[] = [
	{ name: "pass", code: 0 },
	{ name: "fail" },
];

/** The exits a new Command node starts with. */
export const DEFAULT_COMMAND_EXITS: CommandExit[] = [
	{ name: "success", code: 0, description: "The command succeeded." },
	{ name: "error", code: 1, description: "General error." },
	{ name: "other", description: "Any other exit code." },
];

/**
 * Common exit codes on Linux and macOS, offered when adding an exit.
 * 128 + n is "killed by signal n".
 */
export const STANDARD_EXIT_CODES: CommandExit[] = [
	{ name: "success", code: 0, description: "The command succeeded." },
	{ name: "error", code: 1, description: "General error." },
	{
		name: "misuse",
		code: 2,
		description: "Wrong use of a shell builtin or wrong arguments.",
	},
	{
		name: "cannot-execute",
		code: 126,
		description: "The command was found but cannot run.",
	},
	{ name: "not-found", code: 127, description: "The command was not found." },
	{
		name: "interrupted",
		code: 130,
		description: "Stopped with Ctrl+C (SIGINT).",
	},
	{
		name: "killed",
		code: 137,
		description: "Killed (SIGKILL), often out of memory.",
	},
	{ name: "terminated", code: 143, description: "Terminated (SIGTERM)." },
];

export const commandNodeSchema = z.object({
	...nodeBase,
	...placed,
	type: z.literal("command"),
	/**
	 * Run with `sh -c` in the worktree. The exit code picks the outcome (`exits`). Template values
	 * arrive as environment variables, never as shell text: write
	 * `echo "{{worker.summary}}"` and the shell sees `echo "${NS_WORKER_SUMMARY}"`.
	 */
	command: z.string().min(1),
	/**
	 * `text`: the output is the log tail only. `json`: the command prints
	 * JSON, kept as `data` for later nodes (`{{check.data.tests}}`); output
	 * that is not JSON ends the step on the catch-all exit.
	 */
	output: z.enum(["text", "json"]).default("text"),
	/**
	 * The outcome per exit code, each with an edge. A code without an exit
	 * ends on the catch-all; without a catch-all the step errors. Unset:
	 * `pass` on 0 and `fail` on any other code (`commandExits`).
	 */
	exits: z.array(commandExitSchema).min(1).optional(),
});

/**
 * Picks one of its options, which is the step's outcome. `by` says who:
 * `person` (a Gate: the question waits in the Needs-you inbox), `rule`
 * (the first option whose `when` holds, no cost), or `model` (a small
 * model reads the prompt and picks).
 */
export const decisionNodeSchema = z.object({
	...nodeBase,
	/** `by: "model"` only: where the model is asked. */
	...placed,
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
 * How a Call node runs its flow once per element of a list. An element is
 * any JSON value. An object element may carry `id` (else `name`, else its
 * position), `title`, `url`, `dependsOn` (ids, or `{ id, done }`), and
 * `done` (true: skipped).
 */
export const callEachSchema = z.object({
	/** Read again before each element, so elements added during the run run too. */
	source: listSourceSchema,
	/** The input of the called flow that receives the element. */
	as: nameSchema.default("item"),
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
 * Runs another flow of the project: once, or once per element of a list
 * with `each`. `inputs` binds each input of the called flow to a template
 * (with `each`, the element goes to the input named by `each.as`).
 *
 * Once: ends `pass` or `fail`; its outputs are the called flow's outputs,
 * plus `ended` (the label or choice it ended on, or "") and `visit`.
 * With `each`: ends `done` or `halted`; its outputs count the elements and
 * hold each one's result in `results` (`callEachOutputFields`).
 *
 * Either way it ends `stopped` when the run's stop time comes while it runs.
 * Without an edge on `stopped` the run stops there, as anywhere. With one,
 * the run goes on along it, and the nodes after it run past the stop time:
 * they wrap the night up (a report, a stack of pull requests). The element
 * that was running ends `failed`. The run then finishes, it cannot be resumed.
 */
export const callNodeSchema = z.object({
	...nodeBase,
	type: z.literal("call"),
	flow: flowNameSchema,
	inputs: bindings.default({}),
	each: callEachSchema.optional(),
});

/**
 * Who makes a Value node's data: a rule (a JSONata expression) or a model
 * (a decider that can make a value). `person` (a form in the Needs-you
 * inbox, drawn from the output schema) is left for later: add it here and
 * a producer in the engine when a flow needs typed answers.
 */
export const valueBySchema = z.enum(["rule", "model"]);
export type ValueBy = z.infer<typeof valueBySchema>;

/**
 * The twin of a Decision: a Decision picks a label, a Value makes `data`
 * that matches `output`, and `by` says who. `pass` when the data matches,
 * `fail` when the expression throws, the model fails, or the result does not
 * match. Later nodes read `{{<node>.data}}` or a path into it.
 */
export const valueNodeSchema = z.object({
	...nodeBase,
	/** `by: "model"` only: where the model is asked. */
	...placed,
	type: z.literal("value"),
	by: valueBySchema,
	/** A JSON Schema for `data`. The step passes only with data that matches it. */
	output: jsonSchemaSchema,
	/**
	 * `by: "rule"` only: a JSONata expression over the run's values, the same
	 * context a Decision's rule reads (`ruleContext`), for example
	 * `$filter(planner.data.tasks, function($t) { $t.size = "small" })`.
	 */
	expression: z.string().optional(),
	/** `by: "model"` only: the brief for the model. Supports templates. */
	prompt: z.string().optional(),
	/** `by: "model"` only: a decider that can make a value (`valueDeciderNameSchema`). */
	decider: deciderNameSchema.default("openrouter"),
	/** `by: "model"` only. The decider's model. Unset: the decider's default chat model. */
	model: z.string().min(1).optional(),
});

/**
 * What a Wait node waits for. `duration`: a number of minutes. `time`: a
 * template that renders a date and time (`2026-10-18T07:00`, with an
 * optional zone) or a time of day (`07:00`: the next one on this computer's
 * clock). `command`: a command (`sh -c` in the worktree, template values as
 * environment variables, as in a Command node) run every `everyMinutes`
 * until it exits 0. `signal`: a name someone sends to the run.
 */
export const waitUntilSchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("duration"),
		minutes: z.number().int().positive(),
	}),
	z.object({ kind: z.literal("time"), at: z.string().min(1) }),
	z.object({
		kind: z.literal("command"),
		command: z.string().min(1),
		everyMinutes: z.number().int().positive(),
	}),
	z.object({ kind: z.literal("signal"), name: labelSchema }),
]);
export type WaitUntil = z.infer<typeof waitUntilSchema>;

/**
 * Sleeps until a time, a command passes, or a signal arrives, then ends
 * `done`. `timeoutMinutes` bounds every kind: the step ends `timeout` when
 * it runs out. Outputs: `waited_minutes`, and the last `log_tail` of a
 * command.
 */
export const waitNodeSchema = z.object({
	...nodeBase,
	type: z.literal("wait"),
	until: waitUntilSchema,
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
	...placed,
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
	callNodeSchema,
	valueNodeSchema,
	waitNodeSchema,
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
export type CallNode = z.infer<typeof callNodeSchema>;
export type CallEach = z.infer<typeof callEachSchema>;
/** A Call node with `each`: it runs its flow once per element. */
export type CallEachNode = CallNode & { each: CallEach };
export type ValueNode = z.infer<typeof valueNodeSchema>;
export type WaitNode = z.infer<typeof waitNodeSchema>;
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

/** Whether the node is a Call node that runs its flow once per element. */
export function runsEach(node: FlowNode): node is CallEachNode {
	return node.type === "call" && node.each !== undefined;
}

/** A Command node's exits: its own, else pass on 0 and fail on any other code. */
export function commandExits(node: Pick<CommandNode, "exits">): CommandExit[] {
	return node.exits ?? LEGACY_COMMAND_EXITS;
}

/**
 * The exit a code ends on: the exit with that code, else the catch-all,
 * else undefined (the step errors). A null code (the command did not start
 * or its JSON is not valid) ends on the catch-all.
 */
export function exitFor(
	node: Pick<CommandNode, "exits">,
	code: number | null,
): CommandExit | undefined {
	const exits = commandExits(node);
	return (
		(code === null ? undefined : exits.find((exit) => exit.code === code)) ??
		exits.find((exit) => exit.code === undefined)
	);
}

/** The outcomes a node can end with, in the order its handles show. */
export function nodeOutcomes(node: FlowNode): readonly Outcome[] {
	switch (node.type) {
		case "agent":
			return node.outcomes
				? node.outcomes.map((o) => o.name)
				: ["pass", "fail", "needs-input"];
		case "command":
			return commandExits(node).map((exit) => exit.name);
		case "decision":
			return node.options.map((option) => option.name);
		case "call":
			return node.each
				? ["done", "halted", "stopped"]
				: ["pass", "fail", "stopped"];
		case "value":
			return ["pass", "fail"];
		case "wait":
			return ["done", "timeout"];
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
 * node that has not run yet renders as an empty string. `data` (Agent,
 * Value, and a Command with `output: "json"`) and `results` (a Call with
 * `each`) hold JSON and take a deeper path. A Call node's fields depend on
 * `each`, and without it the node also has the outputs of the flow it calls:
 * use `nodeOutputFields`.
 */
export const outputFieldsByType = {
	/** output: the final message. summary: the report's summary, else the output. data: the report's JSON. note: why the checker picked the outcome. */
	agent: [
		"outcome",
		"output",
		"summary",
		"data",
		"note",
		"visit",
		"session_id",
	],
	/** log_tail: the last lines of stdout and stderr together. data: the JSON it printed, with `output: "json"`. */
	command: ["outcome", "exit_code", "log_tail", "data", "visit"],
	/** outcome: the option. note: what the person wrote, or why the model picked it. */
	decision: ["outcome", "note", "visit"],
	/** Without `each`. ended: the label or choice the called flow ended on, or "". */
	call: ["outcome", "ended", "visit"],
	/** data: the value made (null on fail). note: why it failed, or the model's note. */
	value: ["outcome", "data", "note", "visit"],
	/** waited_minutes: how long the step waited. log_tail: the last output of a command it waited on. */
	wait: ["outcome", "waited_minutes", "log_tail", "visit"],
	/**
	 * data: the tool's structured content, else the JSON its text holds, else
	 * null. text: the text content, joined.
	 */
	tool: ["outcome", "data", "text", "visit"],
} as const satisfies Record<FlowNodeType, readonly string[]>;

/**
 * The fields of a Call node with `each`: counts per element state; summary:
 * one line per element; results: a JSON array of `{ id, title, state,
 * reason, outputs }` per element.
 */
export const callEachOutputFields = [
	"outcome",
	"done_count",
	"failed_count",
	"blocked_count",
	"waiting_count",
	"summary",
	"results",
	"visit",
] as const;

/** Output fields that hold JSON, so a template may take a path below them. */
export const jsonOutputFields = ["data", "results"] as const;

/**
 * Fields of the run: `{{run.branch}}`. Inside a Call with `each`, `branch`
 * is the element's branch, `base_branch` the branch it builds on, and
 * `index` the element's position (from 0). Outside, both are "".
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
 * The fields a later node can read from `node`: `outputFieldsByType`
 * (`callEachOutputFields` for a Call with `each`), plus for a Call node
 * without `each` the output names of the flow it calls, when known.
 */
export function nodeOutputFields(
	node: FlowNode,
	called?: Flow | null,
): readonly string[] {
	if (runsEach(node)) return callEachOutputFields;
	const fields: readonly string[] = outputFieldsByType[node.type];
	if (node.type !== "call" || !called) return fields;
	const outputs = called.outputs
		.map((output) => output.name)
		.filter((name) => !fields.includes(name));
	return [...fields, ...outputs];
}
