import {
	type CallEach,
	type FlowNode,
	type NameClash,
	type NodeOption,
	nameClash,
	removeOutcome,
	renameNode,
	renameOutcome,
	restoreAgentOutcomes,
	restoreCallEach,
	restoreOutcome,
	setAgentOutcomes,
	setCallEach,
} from "@nightshift/flows";
import { toast } from "sonner";
import { outcomeLabel } from "../canvas/outcome-badge";
import { optionNoun } from "../flow-draft";
import type { EditingSession } from "./session/editing-session";

/** Why a node cannot take a name, by what the name clashes with. */
const NODE_NAME_TAKEN: Record<NameClash, (name: string) => string> = {
	reserved: (name) => `The name ${name} is taken. Pick another name.`,
	rule: (name) =>
		`Since last run rules read ${name} as their own value. Pick another name.`,
	template: (name) =>
		`Nodes with a cascade read ${name} as their own value. Pick another name.`,
	node: (name) => `${name} is taken by another node.`,
	input: (name) =>
		`An input of this flow is already named ${name}. Pick another name.`,
	variable: (name) =>
		`A variable of this flow is already named ${name}. Pick another name.`,
};

/**
 * The edits of the selected node that reach past the node: a rename, and
 * outcome edits that drop edges. A drop says so in a toast with an undo.
 */
export function nodeEdits(session: EditingSession) {
	const renameSelected = (node: FlowNode) => (next: string) => {
		const clash = nameClash(session.get().draft, next, { node: node.id });
		if (clash !== null) return NODE_NAME_TAKEN[clash](next);
		session.edit((current) => renameNode(current, node.id, next));
		session.select({ kind: "node", id: next });
		return null;
	};

	const renameSelectedOutcome =
		(node: FlowNode) => (index: number, name: string) => {
			session.edit((current) => renameOutcome(current, node.id, index, name));
			return null;
		};

	// Dropping a label drops its edges too: say so, and offer to put them back.
	const removeSelectedOutcome = (node: FlowNode) => (index: number) => {
		const result = removeOutcome(session.get().draft, node.id, index);
		const { option, dropped, cleared } = result;
		if (!option) return;
		session.edit((current) => removeOutcome(current, node.id, index).flow);
		if (dropped.length === 0) return;
		const noun = optionNoun(node);
		toast.info(
			`Removed the ${noun} ${outcomeLabel(option.name)} and ${dropped.length} ${dropped.length === 1 ? "edge" : "edges"} on it.`,
			{
				description: dropped
					.map((edge) => `${edge.from} → ${edge.to}`)
					.join(", "),
				action: {
					label: "Undo",
					onClick: () =>
						session.edit((current) =>
							restoreOutcome(current, node.id, index, option, dropped, cleared),
						),
				},
			},
		);
	};

	// Own outcomes on or off: edges on outcomes the node drops go too, with an undo.
	const setSelectedCallEach =
		(node: FlowNode) => (each: CallEach | undefined) => {
			const result = setCallEach(session.get().draft, node.id, each);
			session.edit((current) => setCallEach(current, node.id, each).flow);
			const { dropped, previous } = result;
			if (dropped.length === 0) return;
			toast.info(
				`Removed ${dropped.length} ${dropped.length === 1 ? "edge" : "edges"} on outcomes ${node.id} no longer has.`,
				{
					description: dropped
						.map(
							(edge) =>
								`${edge.from} ${outcomeLabel(edge.outcome)} → ${edge.to}`,
						)
						.join(", "),
					action: {
						label: "Undo",
						onClick: () =>
							session.edit((current) =>
								restoreCallEach(current, node.id, previous, dropped),
							),
					},
				},
			);
		};

	const setSelectedAgentOutcomes =
		(node: FlowNode) => (outcomes: NodeOption[] | undefined) => {
			const result = setAgentOutcomes(session.get().draft, node.id, outcomes);
			session.edit(
				(current) => setAgentOutcomes(current, node.id, outcomes).flow,
			);
			const { dropped, previous } = result;
			if (dropped.length === 0) return;
			toast.info(
				`Removed ${dropped.length} ${dropped.length === 1 ? "edge" : "edges"} on outcomes ${node.id} no longer has.`,
				{
					description: dropped
						.map(
							(edge) =>
								`${edge.from} ${outcomeLabel(edge.outcome)} → ${edge.to}`,
						)
						.join(", "),
					action: {
						label: "Undo",
						onClick: () =>
							session.edit((current) =>
								restoreAgentOutcomes(current, node.id, previous, dropped),
							),
					},
				},
			);
		};

	return {
		renameSelected,
		renameSelectedOutcome,
		removeSelectedOutcome,
		setSelectedCallEach,
		setSelectedAgentOutcomes,
	};
}
