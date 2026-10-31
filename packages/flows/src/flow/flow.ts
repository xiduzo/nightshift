import { z } from "zod";
import {
	agentNodeSchema,
	callNodeSchema,
	commandNodeSchema,
	decisionNodeSchema,
	endNodeSchema,
	joinNodeSchema,
	jsonSchemaSchema,
	labelSchema,
	leaseNodeSchema,
	nameSchema,
	nodeIdSchema,
	toolNodeSchema,
	valueNodeSchema,
	waitNodeSchema,
} from "../nodes";

/**
 * The flow format: what Night Shift keeps for each flow of a project.
 * The schema checks shape only. `validateFlow` checks meaning (unbounded
 * loops, unknown names, template references, calls between flows).
 *
 * A flow is a function: it declares `inputs`, runs its nodes, and returns
 * `outputs` to whoever called it (a run, or a Call node). Older files
 * migrate on load (`migrateFlow`).
 *
 * Each node type has its own file in `nodes/`. This file puts them
 * together with the edges, inputs, outputs, variables, policy and the
 * editor's Sections.
 */

export const FLOW_VERSION = 7;

export const flowNodeSchema = z.discriminatedUnion("type", [
	agentNodeSchema,
	commandNodeSchema,
	decisionNodeSchema,
	callNodeSchema,
	valueNodeSchema,
	waitNodeSchema,
	toolNodeSchema,
	endNodeSchema,
	joinNodeSchema,
	leaseNodeSchema,
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
	 * engine takes the first one (in file order) that has not hit its max,
	 * and one edge without a max after them is the way on when all did.
	 * Several edges without a max on one outcome run all at once: a fan-out,
	 * whose branches meet at a Join (`flow/branches.ts`).
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
	 * The most a run may spend, in USD, as far as its cost is known (an
	 * estimate counts). Past it the run stops `failed`; a resume may spend
	 * as much again. Unset: the daemon's setting, else no budget.
	 */
	budgetUsd: z.number().positive().optional(),
	/**
	 * The most turns (model replies) one session of an Agent step may take,
	 * unless the node sets its own. Past it the step ends `fail`. Unset:
	 * the daemon's setting, else no limit.
	 */
	maxTurns: z.number().int().positive().optional(),
	/**
	 * An Agent step with no activity for this long ends `fail`, unless the
	 * node sets its own `idleMinutes`.
	 */
	idleMinutes: z.number().positive().optional(),
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
/**
 * The type of a flow input. `text` and `choice` give text, `number` a
 * number, `boolean` true or false, `json` any JSON value.
 */
export const flowInputTypeSchema = z.enum([
	"text",
	"number",
	"boolean",
	"choice",
	"json",
]);

export const flowInputSchema = z.object({
	name: nameSchema,
	type: flowInputTypeSchema.default("text"),
	/** Shown in the start dialog. Defaults to the name. */
	label: z.string().optional(),
	description: z.string().optional(),
	/**
	 * Used when no value is given, as text: JSON text for `json`, `42` for
	 * `number`, `true` or `false` for `boolean`, one of `options` for `choice`.
	 */
	default: z.string().optional(),
	/** `choice` only: the values to pick from. */
	options: z.array(z.string()).optional(),
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

/**
 * The type of a variable. `json` is any JSON value, held to `schema` when
 * the variable has one.
 */
export const variableTypeSchema = z.enum(["text", "number", "boolean", "json"]);

/**
 * Where a kept variable lives between runs. `project`: one value per flow
 * and variable in the project, on the computer that runs the flow.
 */
const variableKeepSchema = z.enum(["project"]);

/**
 * A named, typed value the flow keeps while it runs, like a local variable
 * of a function. Each invocation of the flow (a run's top-level flow, a
 * Call, each element of a Call with `each`) has its own. Nodes read it as
 * `{{vars.<name>}}` and change it with `set`. A kept variable (`keep`)
 * also lives on between runs.
 */
export const flowVariableSchema = z.object({
	name: nameSchema,
	type: variableTypeSchema.default("text"),
	/** `json` only: a JSON Schema every value must match. */
	schema: jsonSchemaSchema.optional(),
	/**
	 * A template, rendered when the flow starts: it reads the inputs and
	 * `run`, never a node. Text is read as the type. Unset: null.
	 */
	initial: z.string().optional(),
	description: z.string().optional(),
	/**
	 * Keep the value between runs. A run starts from the value the last
	 * write of this flow in this project left, else from `initial`; each
	 * write saves it. A called flow keeps its own. Unset: every run starts
	 * from `initial`.
	 */
	keep: variableKeepSchema.optional(),
});

/**
 * The colours a Section can take: names, not values, so the file stays
 * the same in light and dark. The web app maps each name to its theme
 * colour. A subset of the outcome colours. Unset: a neutral frame.
 */
export const sectionColors = [
	"gray",
	"red",
	"orange",
	"yellow",
	"green",
	"teal",
	"blue",
	"violet",
	"pink",
] as const;
export const sectionColorSchema = z.enum(sectionColors);

/**
 * A named, coloured group of nodes of this flow, in the editor. The engine
 * reads one only where a Lease node holds its lease for it: the run lets
 * go of the lease when it leaves the Section. Its nodes should form one connected
 * part that the flow enters at one node (`validateFlow` warns when they do
 * not). The canvas shows it as one box. You open the box to see its nodes,
 * and the Sections inside it as boxes of their own.
 */
export const flowSectionSchema = z.object({
	id: z.string().min(1),
	label: z.string(),
	color: sectionColorSchema.optional(),
	description: z.string().optional(),
	/**
	 * The ids of the nodes in the Section itself. A node is in at most one
	 * Section: the lowest one that holds it.
	 */
	nodes: z.array(nodeIdSchema),
	/**
	 * The ids of the Sections inside this one. A Section is inside at most
	 * one other. Optional, so a Section without Sections inside keeps its
	 * place in the file as it is.
	 */
	sections: z.array(z.string().min(1)).optional(),
});

export const flowSchema = z.object({
	version: z.literal(FLOW_VERSION),
	description: z.string().optional(),
	inputs: z.array(flowInputSchema).default([]),
	outputs: z.array(flowOutputSchema).default([]),
	/** Optional, so a flow without variables keeps its file as it is. */
	variables: z.array(flowVariableSchema).optional(),
	/** Used when this flow is the top-level flow of a run. */
	policy: policySchema.optional(),
	/** The node the flow starts at. */
	start: nodeIdSchema,
	nodes: z.array(flowNodeSchema),
	edges: z.array(flowEdgeSchema),
	/**
	 * Frames around nodes, for the editor only. Optional, so a flow without
	 * Sections keeps its file as it is, and no version change: a Night Shift
	 * that does not know them still runs the flow the same.
	 */
	sections: z.array(flowSectionSchema).optional(),
});

export type Flow = z.infer<typeof flowSchema>;
/** What a flow file holds before defaults apply. Write files in this shape. */
export type FlowInput = z.input<typeof flowSchema>;
export type FlowNode = z.infer<typeof flowNodeSchema>;
export type Policy = z.infer<typeof policySchema>;
/**
 * The policy values that may stay unset: the step cap and the resume
 * switch (the engine reads the setting when it applies), and the run
 * budget and the turn limit (none unless the flow or the settings set one).
 */
type OpenPolicyKey =
	| "maxSteps"
	| "resumeInterruptedRuns"
	| "budgetUsd"
	| "maxTurns";

/**
 * A policy with every wait filled in: the flow's own, else the daemon's
 * setting. The open values (`OpenPolicyKey`) stay the flow's own: the
 * engine reads the setting when it applies.
 */
export type ResolvedPolicy = Required<Omit<Policy, OpenPolicyKey>> &
	Pick<Policy, OpenPolicyKey>;

/** Every policy value, as the settings hold it: null for no budget or no turn limit. */
export type PolicyValues = Required<Omit<Policy, "budgetUsd" | "maxTurns">> & {
	budgetUsd: number | null;
	maxTurns: number | null;
};

/**
 * The built-in run policy: what each value is when neither the flow nor the
 * daemon's settings set it. The settings fall back to these.
 */
export const DEFAULT_POLICY: Readonly<PolicyValues> = {
	usageLimitFirstWaitMinutes: 5,
	usageLimitMaxWaitMinutes: 60,
	networkGraceMinutes: 240,
	maxSteps: 500,
	resumeInterruptedRuns: true,
	budgetUsd: null,
	maxTurns: null,
	idleMinutes: 15,
};

/** The daemon settings that hold the run policy of a flow that does not set its own. */
type PolicySettings = {
	usageLimitFirstWaitMinutes: number;
	usageLimitMaxWaitMinutes: number;
	networkGraceMinutes: number;
	maxStepsPerRun: number;
	resumeInterruptedRuns: boolean;
	budgetUsd: number | null;
	maxTurns: number | null;
	idleMinutes: number;
};

/** The run policy of a flow that sets none of its own: the daemon's settings. */
export function policyFromSettings(settings: PolicySettings): PolicyValues {
	return {
		usageLimitFirstWaitMinutes: settings.usageLimitFirstWaitMinutes,
		usageLimitMaxWaitMinutes: settings.usageLimitMaxWaitMinutes,
		networkGraceMinutes: settings.networkGraceMinutes,
		maxSteps: settings.maxStepsPerRun,
		resumeInterruptedRuns: settings.resumeInterruptedRuns,
		budgetUsd: settings.budgetUsd,
		maxTurns: settings.maxTurns,
		idleMinutes: settings.idleMinutes,
	};
}
export type FlowInputDef = z.infer<typeof flowInputSchema>;
export type FlowOutputDef = z.infer<typeof flowOutputSchema>;
export type FlowVariableDef = z.infer<typeof flowVariableSchema>;
export type VariableType = z.infer<typeof variableTypeSchema>;
export type FlowEdge = z.infer<typeof flowEdgeSchema>;
export type FlowSection = z.infer<typeof flowSectionSchema>;
export type SectionColor = z.infer<typeof sectionColorSchema>;
export type Outcome = z.infer<typeof outcomeSchema>;
export type FlowNodeType = FlowNode["type"];
