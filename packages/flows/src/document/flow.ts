import { z } from "zod";
import {
	agentNodeSchema,
	callNodeSchema,
	commandNodeSchema,
	decisionNodeSchema,
	jsonSchemaSchema,
	labelSchema,
	nameSchema,
	nodeIdSchema,
	toolNodeSchema,
	valueNodeSchema,
	waitNodeSchema,
} from "../nodes";

/**
 * The flow file format: `.nightshift/flows/<name>.json` in the user's clone.
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

export const FLOW_VERSION = 5;

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

/**
 * The type of a variable. `json` is any JSON value, held to `schema` when
 * the variable has one.
 */
export const variableTypeSchema = z.enum(["text", "number", "boolean", "json"]);

/**
 * A named, typed value the flow keeps while it runs, like a local variable
 * of a function. Each invocation of the flow (a run's top-level flow, a
 * Call, each element of a Call with `each`) has its own. Nodes read it as
 * `{{vars.<name>}}` and change it with `set`.
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
 * A named, coloured frame around nodes of this flow, in the editor only:
 * the engine and the run do not read it. Its nodes should form one
 * connected part that the flow enters at one node (`validateFlow` warns
 * when they do not). Whether it is folded is not in the file: each person
 * folds it in their own browser.
 */
export const flowSectionSchema = z.object({
	id: z.string().min(1),
	label: z.string(),
	color: sectionColorSchema.optional(),
	description: z.string().optional(),
	/** The ids of the nodes in the Section. A node is in at most one Section. */
	nodes: z.array(nodeIdSchema),
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
 * A policy with every wait filled in: the flow's own, else the daemon's
 * setting. `maxSteps` and `resumeInterruptedRuns` stay the flow's own: the
 * engine reads the setting when it applies.
 */
export type ResolvedPolicy = Required<
	Omit<Policy, "maxSteps" | "resumeInterruptedRuns">
> &
	Pick<Policy, "maxSteps" | "resumeInterruptedRuns">;

/**
 * The built-in run policy: what each value is when neither the flow nor the
 * daemon's settings set it. The settings fall back to these.
 */
export const DEFAULT_POLICY: Readonly<Required<Policy>> = {
	usageLimitFirstWaitMinutes: 5,
	usageLimitMaxWaitMinutes: 60,
	networkGraceMinutes: 240,
	maxSteps: 500,
	resumeInterruptedRuns: true,
};

/** The daemon settings that hold the run policy of a flow that does not set its own. */
type PolicySettings = {
	usageLimitFirstWaitMinutes: number;
	usageLimitMaxWaitMinutes: number;
	networkGraceMinutes: number;
	maxStepsPerRun: number;
	resumeInterruptedRuns: boolean;
};

/** The run policy of a flow that sets none of its own: the daemon's settings. */
export function policyFromSettings(settings: PolicySettings): Required<Policy> {
	return {
		usageLimitFirstWaitMinutes: settings.usageLimitFirstWaitMinutes,
		usageLimitMaxWaitMinutes: settings.usageLimitMaxWaitMinutes,
		networkGraceMinutes: settings.networkGraceMinutes,
		maxSteps: settings.maxStepsPerRun,
		resumeInterruptedRuns: settings.resumeInterruptedRuns,
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
