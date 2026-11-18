import { endsFlow, type Flow, type FlowNode } from "../../flow";
import { type SectionExit, sectionBoundary } from "../../sections";
import { templateRefs } from "../../template";
import { type NodeRead, readsOf } from "../names";
import type { SubflowBlocker, SubflowOptions, SubflowReader } from "./plan";

/**
 * The plan's analysis of one Section, and what the steps of the plan
 * share: the names they claim, the fields of a Call, the space between
 * the nodes they place.
 */

/** Run fields that read differently inside a Call: they become inputs. */
const CALL_RUN_FIELDS = ["flow", "base_branch", "index"] as const;
type CallRunField = (typeof CALL_RUN_FIELDS)[number];
export const isCallRunField = (
	field: string | undefined,
): field is CallRunField =>
	(CALL_RUN_FIELDS as readonly (string | undefined)[]).includes(field);
/** The fields a Call node has besides its flow's outputs. */
export const CALL_FIELDS = [
	"outcome",
	"ended",
	"end_message",
	"end_report",
	"visit",
];
/** The space between nodes the plan places. */
export const STEP_X = 384;
export const STEP_Y = 144;

/** One reference of a template or a rule: a node's (`readsOf`) or a flow output's. */
export type Read = Omit<NodeRead, "reader"> & { reader: SubflowReader };

/**
 * Whether the node ending with `outcome` and no edge ends its flow as
 * chosen (`finished`), not as a failure: the definition's, which the
 * engine's walk reads too. A stop never ends a flow: the walk parks it.
 */
export function endsFlowOn(node: FlowNode, outcome: string): boolean {
	return outcome !== "stopped" && endsFlow(node, outcome);
}

/** `base`, else `base<sep>2`, … not in `taken`, at most `max` long. Adds the result to `taken`. */
export function claim(
	taken: Set<string>,
	base: string,
	max: number,
	sep: string,
): string {
	const trim = (text: string) => text.slice(0, max).replace(/[-_]+$/, "");
	let name = trim(base);
	for (let n = 2; taken.has(name); n++) {
		const suffix = `${sep}${n}`;
		name = `${trim(base).slice(0, max - suffix.length)}${suffix}`;
	}
	taken.add(name);
	return name;
}

/** A name a template reads (`[a-z][a-z0-9_]*`, at most 40) from any text. */
export function nameFrom(text: string): string {
	const name = text.toLowerCase().replace(/[^a-z0-9_]+/g, "_");
	return /^[a-z]/.test(name) ? name : `flow_${name}`;
}

export function uniqueList<T>(items: readonly T[]): T[] {
	return [...new Set(items)];
}

export function groupKey(exit: Pick<SectionExit, "from" | "outcome">): string {
	return `${exit.from}\u0000${exit.outcome}`;
}

/** The plan's analysis of one Section: what crosses its frame, and what that needs. */
export class Planner {
	readonly byId: Map<string, FlowNode>;
	readonly members: Set<string>;
	readonly inner: FlowNode[];
	readonly exits: SectionExit[];
	readonly reads: Read[];

	constructor(
		readonly flow: Flow,
		nodeIds: readonly string[],
		readonly entry: string,
		readonly options: SubflowOptions,
	) {
		this.byId = new Map(flow.nodes.map((node) => [node.id, node]));
		this.members = new Set(nodeIds.filter((id) => this.byId.has(id)));
		this.inner = flow.nodes.filter((node) => this.members.has(node.id));
		this.exits = sectionBoundary(flow, [...this.members]).outgoing;
		this.reads = [
			...flow.nodes.flatMap(readsOf),
			...flow.outputs.flatMap((output) =>
				templateRefs(output.value).map(
					(ref): Read => ({
						reader: { output: output.name },
						name: ref.name,
						path: ref.path,
						self: false,
						rule: false,
					}),
				),
			),
		];
	}

	inside(reader: SubflowReader): boolean {
		return "node" in reader && this.members.has(reader.node);
	}

	isOuterNode(name: string): boolean {
		return this.byId.has(name) && !this.members.has(name);
	}

	/** Everything that keeps the Section from becoming a Subflow, before the plan is built. */
	blockers(): SubflowBlocker[] {
		const blockers: SubflowBlocker[] = [];
		const edges = this.flow.edges;

		const stopped = this.inner.filter(
			(node) =>
				node.type === "call" &&
				edges.some((e) => e.from === node.id && e.outcome === "stopped"),
		);
		if (stopped.length > 0)
			blockers.push({
				code: "stopped-edge",
				nodes: stopped.map((node) => node.id),
			});

		const calling = this.inner.filter(
			(node) => node.type === "call" && node.flow === this.options.name,
		);
		if (calling.length > 0)
			blockers.push({
				code: "calls-new-flow",
				nodes: calling.map((node) => node.id),
			});

		const ends = this.inner.filter((node) => node.type === "end");
		if (ends.length > 0)
			blockers.push({
				code: "end-node",
				nodes: ends.map((node) => node.id),
			});

		for (const exit of this.exits) {
			const group = edges.filter(
				(e) => e.from === exit.from && e.outcome === exit.outcome,
			);
			let countedOutside = false;
			for (const edge of group) {
				if (!this.members.has(edge.to)) {
					if (edge.max !== undefined) countedOutside = true;
				} else if (countedOutside) {
					blockers.push({
						code: "mixed-exit",
						from: exit.from,
						outcome: exit.outcome,
						edges: group.map((e) => e.id),
					});
					break;
				}
			}
		}

		for (const node of this.flow.nodes) {
			const inside = this.members.has(node.id);
			const names = new Set<string>();
			for (const { name, path, rule } of readsOf(node)) {
				if (!rule) continue;
				if (inside ? this.isOuterNode(name) : this.members.has(name))
					names.add(name);
				// These run fields read differently inside a Call.
				const [field] = path;
				if (inside && name === "run" && isCallRunField(field))
					names.add(`run.${field}`);
			}
			if (names.size > 0)
				blockers.push({
					code: inside ? "rule-reads-outside" : "rule-reads-inside",
					node: node.id,
					names: [...names],
				});
		}
		return blockers;
	}
}
