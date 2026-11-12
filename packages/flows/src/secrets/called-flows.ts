import { type Flow, type FlowNode, tierNode } from "../flow";
import { type CallNode, isPersonTier } from "../nodes";
import { TEMPLATE_REF, templateRefs } from "../template";
import { calledFlow, type ProjectFlowMap } from "../validate";

/**
 * The walk over a flow and every flow and kit it calls, as a run would
 * reach them. What a flow uses (`flowSecrets`, `flowConfigUse`) reads each
 * node it visits.
 */

/** Input values known before a run, by name: a literal binding, else a default. */
export type Known = ReadonlyMap<string, string>;

/**
 * The text a template renders before a run: each reference must read a
 * known input. Null when only a run knows it (a node's output, `run`, an
 * input the run gets).
 */
export function knownText(template: string, known: Known): string | null {
	const readsOnlyKnown = templateRefs(template).every(
		(ref) => ref.path.length === 0 && known.has(ref.name),
	);
	if (!readsOnlyKnown) return null;
	return template.replace(
		TEMPLATE_REF,
		(_raw: string, name: string) => known.get(name) ?? "",
	);
}

/** One run of a flow a Call may start: the flow, and its bindings. */
type CalledRun = { flow: string; inputs: Readonly<Record<string, string>> };

/** Every run a Call may start: its own flow, then each tier of its cascade. */
function callRuns(node: CallNode): CalledRun[] {
	const tiers = (node.cascade ?? []).flatMap((tier, index) => {
		if (isPersonTier(tier)) return [];
		const run = tierNode(node, index);
		return run === null ? [] : [{ flow: run.flow, inputs: run.inputs }];
	});
	return [{ flow: node.flow, inputs: node.inputs }, ...tiers];
}

/**
 * The inputs of a called flow known before a run, as the engine binds them:
 * a binding that renders known text that is not empty, else the default.
 * A binding only a run knows, and the input that takes each element of a
 * list (`each.as`), are not known.
 */
function calledInputs(
	called: Flow,
	run: CalledRun,
	each: string | undefined,
	known: Known,
): Known {
	const values = new Map<string, string>();
	for (const input of called.inputs) {
		if (input.name === each) continue;
		const binding = Object.hasOwn(run.inputs, input.name)
			? run.inputs[input.name]
			: undefined;
		const bound = binding === undefined ? "" : knownText(binding, known);
		if (bound === null) continue;
		if (bound.trim() !== "") values.set(input.name, bound);
		else if (input.default !== undefined && input.default.trim() !== "") {
			values.set(input.name, input.default);
		}
	}
	return values;
}

/**
 * Where a walk finds the flows a flow calls. `flows`: the project's flow
 * files. Without them, only kits are known. `name`: the flow's own file
 * name, so that a call back to it adds nothing.
 */
export type CalledFlowsOptions = { flows?: ProjectFlowMap; name?: string };

/**
 * One step of the way a run reaches a node of a called flow: the Call
 * node, and the flow of it that the run enters (its own, or a tier's).
 */
export type CallStep = { node: CallNode; flow: string };

/**
 * What a walk does with each node: `known` holds the inputs known before
 * the run of the flow that holds it, `trail` the calls that lead to it,
 * outermost first. The trail is empty for a node of the walked flow itself.
 */
export type CalledFlowsVisit = (
	node: FlowNode,
	known: Known,
	trail: readonly CallStep[],
) => void;

/** Visits each node of `flow`, and after a Call, each node of the flows it may start. */
function walk(
	flow: Flow,
	known: Known,
	flows: ProjectFlowMap,
	chain: readonly string[],
	trail: readonly CallStep[],
	visit: CalledFlowsVisit,
): void {
	for (const node of flow.nodes) {
		visit(node, known, trail);
		if (node.type !== "call") continue;
		for (const run of callRuns(node)) {
			// A flow that calls back into its chain adds nothing new.
			if (chain.includes(run.flow)) continue;
			const called = calledFlow(run.flow, flows);
			if (called === undefined) continue;
			walk(
				called,
				calledInputs(called, run, node.each?.as, known),
				flows,
				[...chain, run.flow],
				[...trail, { node, flow: run.flow }],
				visit,
			);
		}
	}
}

/**
 * Visits every node a run of `flow` may reach, in order, with the inputs
 * known before the run of the flow that holds it. After a Call node come
 * the nodes of each flow it may start: its own flow, then each tier of its
 * cascade that is not a person, a kit or a flow of `flows`. A flow that
 * calls back into its chain, or that the walk cannot find, adds nothing.
 *
 * An input's value is known when a Call binds it to text without a
 * template, else it is its default: so the flow's own defaults count too.
 * Each visit also gets the calls that lead to the node (`CalledFlowsVisit`).
 */
export function walkCalledFlows(
	flow: Flow,
	options: CalledFlowsOptions,
	visit: CalledFlowsVisit,
): void {
	const own: CalledRun = { flow: options.name ?? "", inputs: {} };
	walk(
		flow,
		calledInputs(flow, own, undefined, new Map()),
		options.flows ?? {},
		options.name === undefined ? [] : [options.name],
		[],
		visit,
	);
}
