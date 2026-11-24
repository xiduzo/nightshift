/** A node by its id, after the Subflow nodes it ran in: "write / draft". */
export function nodeLadderLabel(node: {
	nodeId: string;
	via?: string | undefined;
}): string {
	return [...(node.via ? node.via.split("/") : []), node.nodeId].join(" / ");
}
