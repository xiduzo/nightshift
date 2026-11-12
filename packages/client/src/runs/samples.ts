import type { Flow, FlowNode } from "@nightshift/flows";
import type { RunDetail, StepSummary } from "./types";

/**
 * What a node gave in its newest run: the editor shows it on the node, in
 * the node's inspector, and beside its fields in the template picker.
 */
export type NodeSample = {
	runId: string;
	stepId: string;
	/** Null while the step runs. */
	endedAt: number | null;
	outcome: string | null;
	/** The step's outputs, as the run has them: kept whole, cut only where they show. */
	outputs: StepSummary["outputs"];
	/** The input values of the run the step is in. */
	inputs: RunDetail["inputs"];
	/** The node in the run's flow is not the node of the draft: the output may not fit it now. */
	changed: boolean;
};

/** What `nodeSamples` reads of a run. */
export type SampleRun = Pick<
	RunDetail,
	"id" | "createdAt" | "flow" | "inputs" | "steps"
>;

/**
 * The newest sample of each node of `flow`, by node id, from `runs` (any
 * order). A node's sample is its newest step in the newest run that has
 * one. Steps inside a called flow or a Call's item (`scope`) do not count:
 * their node ids are of another flow. A step of another node type than the
 * draft's node does not count either: the node was retyped since. A node
 * that no run reached has no sample.
 */
export function nodeSamples(
	runs: readonly SampleRun[],
	flow: Pick<Flow, "nodes">,
): Map<string, NodeSample> {
	const draft = new Map(flow.nodes.map((node) => [node.id, node]));
	const samples = new Map<string, NodeSample>();
	const newestFirst = [...runs].sort((a, b) => b.createdAt - a.createdAt);
	for (const run of newestFirst) {
		const ran = new Map(run.flow.nodes.map((node) => [node.id, node]));
		for (const step of newestSteps(run.steps).values()) {
			const node = draft.get(step.nodeId);
			if (
				node === undefined ||
				node.type !== step.nodeType ||
				samples.has(node.id)
			)
				continue;
			samples.set(node.id, {
				runId: run.id,
				stepId: step.id,
				endedAt: step.endedAt,
				outcome: step.outcome,
				outputs: step.outputs,
				inputs: run.inputs,
				changed: nodeChanged(ran.get(node.id), node),
			});
		}
	}
	return samples;
}

/** The newest top-level step of each node of one run. */
function newestSteps(steps: readonly StepSummary[]): Map<string, StepSummary> {
	const newest = new Map<string, StepSummary>();
	for (const step of steps) {
		if (step.scope !== null) continue;
		const seen = newest.get(step.nodeId);
		if (
			seen === undefined ||
			step.startedAt > seen.startedAt ||
			(step.startedAt === seen.startedAt && step.visit > seen.visit)
		)
			newest.set(step.nodeId, step);
	}
	return newest;
}

/** Whether the node differs from the one the run ran, its place on the canvas aside. */
function nodeChanged(ran: FlowNode | undefined, node: FlowNode): boolean {
	if (ran === undefined) return true;
	const { position: _ranAt, ...was } = ran;
	const { position: _nodeAt, ...now } = node;
	return !sameJson(was, now);
}

/** Deep equality of JSON values: key order does not count, a key set to undefined counts as left out. */
function sameJson(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;
	if (Array.isArray(a) || Array.isArray(b)) {
		if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length)
			return false;
		return a.every((item, index) => sameJson(item, b[index]));
	}
	const left = a as Record<string, unknown>;
	const right = b as Record<string, unknown>;
	const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
	for (const key of keys) {
		if (!sameJson(left[key], right[key])) return false;
	}
	return true;
}
