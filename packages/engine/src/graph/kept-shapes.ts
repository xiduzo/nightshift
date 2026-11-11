import {
	type FlowNode,
	inferSchema,
	isKitName,
	RESERVED_DATA_KEYS,
	reservedOutcomes,
	typedOutput,
} from "@nightshift/flows";
import type { Scope, StepOutcome, StepOutputs } from "../log";
import type { KeptFlow } from "../variables";
import { keptFlowOf, type StepContext } from "./context";

/**
 * Typed output by default (any-domain Q40, Q42): a node with no output
 * schema gets one from the first data a run gives. The step's end carries
 * the shapes of its data (`StepEnded.shapes`), and the Walker keeps them on
 * the node, marked inferred, with one revision of kind `infer`
 * (`StepShared.keepShapes`, `ProjectFlows.keepShapes`). A later run that
 * gives other data warns, it does not fail (`outputVerdict`), until a
 * person confirms or changes the schema in the editor.
 */

/** The shapes of a step's data, by output field (`data`): JSON Schemas. */
export type StepShapes = Record<string, Record<string, unknown>>;

/**
 * The flow that keeps the shapes of a step in `scope`: the flow it runs
 * in, by name. Null for a quick run (no flow file) and a kit (Night
 * Shift's own, read only).
 */
function shapesFlowOf(
	ctx: Pick<StepContext, "run" | "flowName">,
	scope: Scope | null,
): KeptFlow | null {
	const flow = keptFlowOf(ctx, scope);
	return flow === null || isKitName(flow.flowName) ? null : flow;
}

/**
 * The shapes of the step's data for its node to keep: only for a node
 * type with an output schema that has none yet, a step that ended on an
 * outcome of its own (not `error`, `stopped`, …) with data, in a flow that
 * keeps them. The keys a command's data may hold whatever its schema says
 * (`outcome`, `scores`) are left out. Undefined when there is nothing to
 * keep.
 */
export function stepShapes(
	ctx: Pick<StepContext, "run" | "flowName">,
	node: FlowNode,
	scope: Scope | null,
	outcome: StepOutcome,
	outputs: StepOutputs,
): StepShapes | undefined {
	const typed = typedOutput(node);
	if (typed === null || typed.schema !== undefined) return undefined;
	if ((reservedOutcomes as readonly string[]).includes(outcome)) {
		return undefined;
	}
	const data = outputs[typed.field];
	if (data === undefined || data === null) return undefined;
	if (shapesFlowOf(ctx, scope) === null) return undefined;
	const schema = withoutReservedKeys(inferSchema(data));
	if (Object.keys(schema).length === 0) return undefined;
	return { [typed.field]: schema };
}

function withoutReservedKeys(
	schema: Record<string, unknown>,
): Record<string, unknown> {
	const properties = schema.properties as Record<string, unknown> | undefined;
	if (properties === undefined) return schema;
	const kept = Object.fromEntries(
		Object.entries(properties).filter(
			([key]) => !(RESERVED_DATA_KEYS as readonly string[]).includes(key),
		),
	);
	return { ...schema, properties: kept };
}

/**
 * Keeps the shapes on the node, through the Walker's flows
 * (`StepShared.keepShapes`). Never throws: a shape that is not kept is
 * inferred again at the next run.
 */
export async function keepShapes(
	ctx: StepContext,
	scope: Scope | null,
	node: FlowNode,
	shapes: StepShapes,
): Promise<void> {
	const flow = shapesFlowOf(ctx, scope);
	if (flow === null || !ctx.keepShapes) return;
	try {
		await ctx.keepShapes(flow, { id: node.id, type: node.type }, shapes);
	} catch (error) {
		console.warn(
			`[engine] Night Shift could not keep the shape of node "${node.id}" of run ${ctx.run.id}:`,
			error,
		);
	}
}
