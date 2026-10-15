import { z } from "zod";

/**
 * The flow file format: `.nightshift/flows/<name>.json` in the user's clone.
 * The schema checks shape only. `validateFlow` checks meaning (unbounded
 * loops, unknown nodes, template references).
 */

export const FLOW_VERSION = 1;

/** A node id is also its name in templates: `{{check.log_tail}}`. */
export const nodeIdSchema = z
	.string()
	.regex(
		/^[a-z][a-z0-9_]{0,39}$/,
		"Use lowercase letters, digits and _, starting with a letter.",
	);

/** A flow file name, without `.json`. */
export const flowNameSchema = z
	.string()
	.regex(
		/^[a-z0-9][a-z0-9-]{0,59}$/,
		"Use lowercase letters, digits and -, starting with a letter or digit.",
	);

/**
 * A Decision label or a Gate choice. It is also an outcome, so edges and
 * templates use it. "error", "stopped", "interrupted" and "waiting" are
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

/** `github`: read issues and pull requests, comment, label, open a pull request. */
export const toolSetSchema = z.enum(["github"]);
export type ToolSet = z.infer<typeof toolSetSchema>;

const option = z.object({
	name: labelSchema,
	/** Tells the decider (or the person) what this option means. */
	description: z.string().optional(),
});

const position = z.object({ x: z.number(), y: z.number() });

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
	/** The message to the agent. Supports `{{node.field}}` and `{{run.field}}`. */
	prompt: z.string(),
	/** A skill the harness already has, run as `/<skill> <prompt>`. */
	skill: z.string().min(1).optional(),
	harness: z.literal("claude-code"),
	model: z.string().min(1),
	effort: z.enum(["low", "medium", "high", "xhigh", "max"]).optional(),
	permissionMode: z.enum([
		"default",
		"acceptEdits",
		"bypassPermissions",
		"plan",
	]),
	/**
	 * `fresh`: every visit starts a new harness session (the script's retry
	 * policy). `resume`: a later visit continues this node's last session.
	 */
	session: z.enum(["fresh", "resume"]).default("fresh"),
	/** Tool sets the agent gets on top of the harness's own tools. */
	tools: z.array(toolSetSchema).default([]),
});

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

export const decisionNodeSchema = z.object({
	...nodeBase,
	type: z.literal("decision"),
	/** What to decide, with the context it needs. Supports templates. */
	prompt: z.string().min(1),
	/** The labels the decider picks from. Each one is an outcome. */
	labels: z.array(option).min(2),
	/** The decider provider. Only Claude Code for now, with no tools of its own. */
	decider: z.literal("claude-code").default("claude-code"),
	/** A small, fast model is enough. */
	model: z.string().min(1).default("haiku"),
	/** Tool sets the decider may use to look things up. */
	tools: z.array(toolSetSchema).default([]),
});

export const gateNodeSchema = z.object({
	...nodeBase,
	type: z.literal("gate"),
	/** What the person is asked, with the context they need. Supports templates. */
	question: z.string().min(1),
	/** The answers the person can give. Each one is an outcome. */
	choices: z.array(option).min(1),
});

export const flowNodeSchema = z.discriminatedUnion("type", [
	agentNodeSchema,
	commandNodeSchema,
	decisionNodeSchema,
	gateNodeSchema,
]);

/** `pass`, `fail`, `needs-input`, or a Decision label or Gate choice. */
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

export const flowSchema = z.object({
	version: z.literal(FLOW_VERSION),
	description: z.string().optional(),
	/** The node the run starts at. */
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
export type GateNode = z.infer<typeof gateNodeSchema>;
export type FlowEdge = z.infer<typeof flowEdgeSchema>;
export type Outcome = z.infer<typeof outcomeSchema>;
export type FlowNodeType = FlowNode["type"];

/** The outcomes a node can end with, in the order its handles show. */
export function nodeOutcomes(node: FlowNode): readonly Outcome[] {
	switch (node.type) {
		case "agent":
			return ["pass", "fail", "needs-input"];
		case "command":
			return ["pass", "fail"];
		case "decision":
			return node.labels.map((label) => label.name);
		case "gate":
			return node.choices.map((choice) => choice.name);
	}
}

/**
 * The fields a later node can read with `{{<nodeId>.<field>}}`. A field of a
 * node that has not run yet renders as an empty string.
 */
export const outputFieldsByType = {
	/** output: the agent's final message. summary: its step report, else the output. */
	agent: ["outcome", "output", "summary", "visit", "session_id"],
	/** log_tail: the last lines of stdout and stderr together. */
	command: ["outcome", "exit_code", "log_tail", "visit"],
	/** outcome: the label. notes: why the decider picked it. */
	decision: ["outcome", "notes", "visit"],
	/** outcome: the choice. note: what the person wrote with it. */
	gate: ["outcome", "note", "visit"],
} as const satisfies Record<FlowNodeType, readonly string[]>;

export type OutputField<T extends FlowNodeType> =
	(typeof outputFieldsByType)[T][number];

/** Fields of the run itself: `{{run.branch}}`. */
export const runFields = ["branch", "worktree", "base_ref", "flow"] as const;
export type RunField = (typeof runFields)[number];
