import type { FlowRange } from "./types";

/** One node's ladder in a flow's detail. */
export type NodeLadder = NonNullable<
	FlowRange["ladders"]
>["nodes"]["rows"][number];

/** A node by its id, after the Subflow nodes it ran in: "write / draft". */
export function nodeLadderLabel(
	node: Pick<NodeLadder, "nodeId" | "via">,
): string {
	return [...(node.via ? node.via.split("/") : []), node.nodeId].join(" / ");
}
