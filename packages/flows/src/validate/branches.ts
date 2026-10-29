import { type FanOut, type Flow, type FlowNode, fanOutsOf } from "../flow";
import type { Report } from "./issues";

/**
 * The checks of parallel branches (`flow/branches.ts`): every fan-out
 * has edges without a max only, its branches each reach the same one Join
 * and share no node, no branch leads back to the node that fans out or
 * fans out again, and only the branches of one fan-out reach a Join. A
 * Join that no fan-out reaches has nothing to wait for.
 *
 * Branches share the run's copy of the project. A warning names the Agents
 * of two or more branches that may edit files at the same time.
 */
export function checkBranches(
	flow: Flow,
	nodes: ReadonlyMap<string, FlowNode>,
	error: Report,
	warning: Report,
): void {
	const fanOuts = fanOutsOf(flow).filter(
		(fanOut) =>
			nodes.has(fanOut.from) &&
			fanOut.edges.every((edge) => nodes.has(edge.to)),
	);
	const sources = new Set(fanOuts.map((fanOut) => fanOut.from));
	/** Each Join, with the fan-outs whose branches reach it. */
	const intoJoin = new Map<string, FanOut[]>();

	for (const fanOut of fanOuts) {
		const at = { nodeId: fanOut.from };
		const { from, outcome } = fanOut;
		for (const edge of fanOut.bounded) {
			error(
				`Edge "${edge.id}" has a max, but "${from}" runs its other edges on "${outcome}" at once. Remove the max, or move this edge to another outcome.`,
				{ edgeId: edge.id },
			);
		}
		const owner = new Map<string, string>();
		for (const branch of fanOut.branches) {
			const entry = branch.edge.to;
			if (branch.loopsBack) {
				error(
					`The branch from "${from}" to "${entry}" leads back to "${from}". A branch ends at its Join.`,
					at,
				);
			}
			if (branch.nodes.length === 0) {
				error(
					`Edge "${branch.edge.id}" goes from "${from}" straight to "${entry}". A branch needs at least one node before its Join.`,
					{ edgeId: branch.edge.id },
				);
				continue;
			}
			if (branch.joins.length === 0) {
				error(
					`The branch from "${from}" to "${entry}" never reaches a Join. Lead every branch of "${from}" on "${outcome}" to the same Join.`,
					at,
				);
			}
			for (const id of branch.nodes) {
				const other = owner.get(id);
				if (other !== undefined && other !== entry) {
					error(
						`The branches of "${from}" through "${other}" and "${entry}" share node "${id}". Give each branch its own nodes.`,
						{ nodeId: id },
					);
				}
				owner.set(id, entry);
				if (nodes.get(id)?.type === "end") {
					error(
						`End node "${id}" is on a branch of "${from}". A branch ends at its Join: put the End after the Join.`,
						{ nodeId: id },
					);
				}
				if (sources.has(id)) {
					error(
						`Node "${id}" fans out inside a branch of "${from}". Put the inner branches in a called flow.`,
						{ nodeId: id },
					);
				}
			}
		}
		const reached = [
			...new Set(fanOut.branches.flatMap((branch) => branch.joins)),
		];
		if (reached.length > 1) {
			error(
				`The branches of "${from}" on "${outcome}" reach different Joins: ${reached.join(", ")}. Lead every branch to the same Join.`,
				at,
			);
		}
		if (fanOut.join !== null) {
			intoJoin.set(fanOut.join, [...(intoJoin.get(fanOut.join) ?? []), fanOut]);
		}
		checkSharedFiles(fanOut, nodes, warning);
	}

	for (const node of nodes.values()) {
		if (node.type !== "join") continue;
		const into = intoJoin.get(node.id) ?? [];
		const reachedBy = fanOuts.filter((fanOut) =>
			fanOut.branches.some((branch) => branch.joins.includes(node.id)),
		);
		if (reachedBy.length === 0) {
			error(
				`Join "${node.id}" has no branches to wait for. Draw several edges from one node on one outcome, and lead each branch here.`,
				{ nodeId: node.id },
			);
			continue;
		}
		if (into.length > 1) {
			error(
				`The branches of ${into.map((fanOut) => `"${fanOut.from}"`).join(" and ")} all reach Join "${node.id}". Give each fan-out its own Join.`,
				{ nodeId: node.id },
			);
			continue;
		}
		const [fanOut] = into;
		if (!fanOut) continue;
		const onBranch = new Set(fanOut.branches.flatMap((branch) => branch.nodes));
		for (const edge of flow.edges) {
			if (edge.to !== node.id || onBranch.has(edge.from)) continue;
			if (fanOut.edges.includes(edge)) continue; // reported above
			error(
				`Edge "${edge.id}" reaches Join "${node.id}" from "${edge.from}", which is not on a branch of "${fanOut.from}". Only the branches of one fan-out reach a Join.`,
				{ edgeId: edge.id },
			);
		}
	}
}

/**
 * Agents on two or more branches whose permission mode lets them edit
 * files: they work in one copy of the project at the same time. A
 * Command is left to its author.
 */
function checkSharedFiles(
	fanOut: FanOut,
	nodes: ReadonlyMap<string, FlowNode>,
	warning: Report,
): void {
	const editors = fanOut.branches.flatMap((branch) => {
		const editor = branch.nodes.find((id) => {
			const node = nodes.get(id);
			return node?.type === "agent" && editsFiles(node.permissionMode);
		});
		return editor === undefined ? [] : [editor];
	});
	if (editors.length < 2) return;
	warning(
		`The branches of "${fanOut.from}" can edit files at the same time: ${editors.map((id) => `"${id}"`).join(", ")}. They share one copy of the project. Let one branch edit, or set the others to plan mode.`,
		{ nodeId: fanOut.from },
	);
}

/** Whether an Agent with this permission mode edits files without asking. Unset (the profile's) is not known here. */
function editsFiles(mode: string | undefined): boolean {
	return (
		mode === "acceptEdits" || mode === "auto" || mode === "bypassPermissions"
	);
}
