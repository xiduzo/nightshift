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

export const flowNodeSchema = z.discriminatedUnion("type", [
	agentNodeSchema,
	commandNodeSchema,
]);

export const outcomeSchema = z.enum(["pass", "fail", "needs-input"]);

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
export type FlowEdge = z.infer<typeof flowEdgeSchema>;
export type Outcome = z.infer<typeof outcomeSchema>;
export type FlowNodeType = FlowNode["type"];

/** The outcomes a node type can end with. */
export const outcomesByType: Record<FlowNodeType, readonly Outcome[]> = {
	agent: ["pass", "fail", "needs-input"],
	command: ["pass", "fail"],
};

/**
 * The fields a later node can read with `{{<nodeId>.<field>}}`. A field of a
 * node that has not run yet renders as an empty string.
 */
export const outputFieldsByType = {
	/** output: the agent's final message. summary: its step report, else the output. */
	agent: ["outcome", "output", "summary", "visit", "session_id"],
	/** log_tail: the last lines of stdout and stderr together. */
	command: ["outcome", "exit_code", "log_tail", "visit"],
} as const satisfies Record<FlowNodeType, readonly string[]>;

export type OutputField<T extends FlowNodeType> =
	(typeof outputFieldsByType)[T][number];

/** Fields of the run itself: `{{run.branch}}`. */
export const runFields = ["branch", "worktree", "base_ref", "flow"] as const;
export type RunField = (typeof runFields)[number];
