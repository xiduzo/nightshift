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
	/** The step fails when the agent shows no activity for this long. */
	idleMinutes: z.number().int().positive().optional(),
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

/**
 * GitHub sub-issues of one parent issue, blockers first ("blocked by"
 * links); among free issues GitHub's order stays.
 */
export const githubSourceSchema = z.object({
	kind: z.literal("github"),
	/** The parent issue number. Supports templates, for example `{{item.number}}`. */
	parent: z.string().min(1),
	/** Only sub-issues with this label become items. */
	requireLabel: z.string().min(1).optional(),
	/** Sub-issues with any of these labels count as done before the run. */
	doneLabels: z.array(z.string().min(1)).default([]),
	/**
	 * Sub-issues with any of these labels are left out (for example `draft`).
	 * Items blocked by them wait, because a left-out blocker is not done.
	 */
	skipLabels: z.array(z.string().min(1)).default([]),
});

/**
 * A command (sh -c in the worktree) that prints a JSON array of items:
 * `{ id, title, body?, url?, blockedBy?: id[], done?: boolean }`.
 */
export const commandSourceSchema = z.object({
	kind: z.literal("command"),
	command: z.string().min(1),
});

export const itemSourceSchema = z.discriminatedUnion("kind", [
	githubSourceSchema,
	commandSourceSchema,
]);

export const forEachNodeSchema = z.object({
	...nodeBase,
	type: z.literal("foreach"),
	/** Read again before each item, so items added during the run get built too. */
	source: itemSourceSchema,
	/** The body: a flow file in the same project with `input: "item"`. */
	flow: flowNameSchema,
	/**
	 * Each item works on its own branch, created on top of the last item
	 * that finished (the stack). Off: all items share the run's branch.
	 */
	branchPerItem: z.boolean().default(true),
	/** A body that ends on one of these labels or choices stops the loop with `halted`. */
	haltOn: z.array(labelSchema).default(["halt"]),
	/** Safety net: the most items one visit may start. */
	maxItems: z.number().int().positive().optional(),
});

export const flowNodeSchema = z.discriminatedUnion("type", [
	agentNodeSchema,
	commandNodeSchema,
	decisionNodeSchema,
	gateNodeSchema,
	forEachNodeSchema,
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

/**
 * The numbers of the run policy. The policy itself is engine code: a usage
 * limit or a network failure waits and then continues the same session.
 */
export const policySchema = z.object({
	/** The first wait after a usage limit without a known reset time. Doubles each time. */
	usageLimitFirstWaitMinutes: z.number().positive().default(5),
	usageLimitMaxWaitMinutes: z.number().positive().default(60),
	/** The longest total wait for the network before the step fails. */
	networkGraceMinutes: z.number().positive().default(240),
});

export const flowSchema = z.object({
	version: z.literal(FLOW_VERSION),
	description: z.string().optional(),
	/**
	 * `item`: this flow is a For Each body. Its templates may read
	 * `{{item.<field>}}`, and a run cannot start it on its own.
	 */
	input: z.literal("item").optional(),
	/** Used for the top-level flow of a run. A body flow uses its parent's. */
	policy: policySchema.optional(),
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
export type ForEachNode = z.infer<typeof forEachNodeSchema>;
export type ItemSource = z.infer<typeof itemSourceSchema>;
export type Policy = z.infer<typeof policySchema>;
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
		case "foreach":
			return ["done", "halted"];
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
	/** Counts per item status, and one line per item: `#12 done`, `#13 blocked by #12`. */
	foreach: [
		"outcome",
		"done_count",
		"failed_count",
		"blocked_count",
		"waiting_count",
		"summary",
		"visit",
	],
} as const satisfies Record<FlowNodeType, readonly string[]>;

export type OutputField<T extends FlowNodeType> =
	(typeof outputFieldsByType)[T][number];

/**
 * Fields of the current item in a For Each body: `{{item.title}}`.
 * `branch` is the item's branch, `base_branch` the branch it builds on.
 * `parent_*` describe the issue the source listed it under.
 */
export const itemFields = [
	"id",
	"number",
	"title",
	"body",
	"url",
	"index",
	"branch",
	"base_branch",
	"parent_number",
	"parent_title",
] as const;
export type ItemField = (typeof itemFields)[number];

/** Fields of the run itself: `{{run.branch}}`. In a For Each body, `branch` is the item's branch. */
export const runFields = ["branch", "worktree", "base_ref", "flow"] as const;
export type RunField = (typeof runFields)[number];
