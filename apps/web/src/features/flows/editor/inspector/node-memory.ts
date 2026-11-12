/** Which memory the inspector of a node lists: its own, or what the nodes inside a Subflow node saw. */
import type { FlowNode } from "@nightshift/flows";

/** One entry of a flow's memory: a node's path from the top flow, and a scope. */
type Entry = { node: string; scope: string };

/** A memory entry as the Memory section lists it. */
export type MemoryRow<E extends Entry> = E & {
	/**
	 * A node inside a Subflow node, named by the calling node:
	 * "Read the feed › fresh". Undefined for the node's own memory.
	 */
	inside?: string;
};

/**
 * The memory entries the inspector of `node` lists. A Since last run node
 * lists its own, one per scope. A Subflow node lists those of every node
 * inside its flow (a path that starts with its id), as a kit's Since last
 * run keeps its memory under the node that calls the kit.
 */
export function memoryOfNode<E extends Entry>(
	entries: readonly E[],
	node: Pick<FlowNode, "id" | "type" | "label">,
): MemoryRow<E>[] {
	if (node.type === "since-last-run") {
		return entries.filter((entry) => entry.node === node.id);
	}
	if (node.type !== "call") return [];
	const prefix = `${node.id}/`;
	const caller = node.label?.trim() || node.id;
	return entries
		.filter((entry) => entry.node.startsWith(prefix))
		.map((entry) => ({
			...entry,
			inside: [caller, ...entry.node.slice(prefix.length).split("/")].join(
				" › ",
			),
		}));
}
