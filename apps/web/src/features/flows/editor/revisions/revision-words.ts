import type { Flow, FlowDiff, FlowEdge, FlowNode } from "@nightshift/flows";
import type { FlowRevisionItem } from "@/shared/api";

/** What made a revision, as its badge says it. */
export const REVISION_KIND_LABEL: Record<FlowRevisionItem["kind"], string> = {
	save: "Saved",
	restore: "Restored",
	import: "Imported",
	copy: "Copied in",
	merge: "Merged",
	upgrade: "Updated by Night Shift",
};

/** Who made a revision and on which computer: "Ada on MacBook". */
export function revisionAuthor(
	item: Pick<FlowRevisionItem, "person" | "device">,
): string {
	const who = item.person ? (item.person.name ?? "A member") : "Night Shift";
	return `${who} on ${item.device.name ?? "another computer"}`;
}

const nodeName = (node: FlowNode) => node.label ?? node.id;

function edgeName(edge: FlowEdge, nodes: ReadonlyMap<string, FlowNode>) {
	const end = (id: string) => {
		const node = nodes.get(id);
		return node ? nodeName(node) : id;
	};
	return `${end(edge.from)} (${edge.outcome}) to ${end(edge.to)}`;
}

/**
 * The changes of a diff as short lines, the nodes first: "Added node
 * Review", "Changed node Build: prompt". A node that only moved counts in
 * one line at the end. `after`, the flow the diff ends at, names the nodes
 * of an edge that did not change themselves.
 */
export function diffLines(diff: FlowDiff, after?: Flow): string[] {
	const nodes = new Map<string, FlowNode>();
	for (const node of [
		...(after?.nodes ?? []),
		...diff.nodes.removed,
		...diff.nodes.added,
	]) {
		nodes.set(node.id, node);
	}
	for (const change of diff.nodes.changed) nodes.set(change.id, change.after);
	const lines: string[] = [];
	const fields = (list: readonly string[]) => list.join(", ");

	for (const node of diff.nodes.added)
		lines.push(`Added node ${nodeName(node)}`);
	for (const node of diff.nodes.removed)
		lines.push(`Removed node ${nodeName(node)}`);
	for (const change of diff.nodes.changed) {
		lines.push(
			`Changed node ${nodeName(change.after)}: ${fields(change.fields)}`,
		);
	}
	for (const edge of diff.edges.added)
		lines.push(`Added edge ${edgeName(edge, nodes)}`);
	for (const edge of diff.edges.removed)
		lines.push(`Removed edge ${edgeName(edge, nodes)}`);
	for (const change of diff.edges.changed) {
		lines.push(
			`Changed edge ${edgeName(change.after, nodes)}: ${fields(change.fields)}`,
		);
	}
	const named = [
		["input", diff.inputs],
		["output", diff.outputs],
		["variable", diff.variables],
	] as const;
	for (const [word, list] of named) {
		for (const item of list.added) lines.push(`Added ${word} ${item.name}`);
		for (const item of list.removed) lines.push(`Removed ${word} ${item.name}`);
		for (const change of list.changed) {
			lines.push(
				`Changed ${word} ${change.after.name}: ${fields(change.fields)}`,
			);
		}
	}
	for (const section of diff.sections.added)
		lines.push(`Added section ${section.label}`);
	for (const section of diff.sections.removed)
		lines.push(`Removed section ${section.label}`);
	for (const change of diff.sections.changed) {
		lines.push(
			`Changed section ${change.after.label}: ${fields(change.fields)}`,
		);
	}
	if (diff.flow.length > 0) {
		lines.push(`Changed the flow settings: ${fields(diff.flow)}`);
	}
	const moved = diff.nodes.moved.length;
	if (moved > 0) lines.push(`Moved ${moved} ${moved === 1 ? "node" : "nodes"}`);
	return lines;
}
