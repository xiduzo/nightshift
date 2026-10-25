import {
	type CallEach,
	type Flow,
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
import type { Dispatch, SetStateAction } from "react";
import { toast } from "sonner";
import { outcomeLabel } from "../canvas/outcome-badge";
import { optionNoun } from "../flow-draft";
import type { Selection } from "./selection";

/** Why a node cannot take a name, by what the name clashes with. */
const NODE_NAME_TAKEN: Record<NameClash, (name: string) => string> = {
	reserved: (name) => `The name ${name} is taken. Pick another name.`,
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
export function nodeEdits(
	draft: Flow,
	setDraft: Dispatch<SetStateAction<Flow>>,
	setSelection: Dispatch<SetStateAction<Selection>>,
) {
	const renameSelected = (node: FlowNode) => (next: string) => {
		const clash = nameClash(draft, next, { node: node.id });
		if (clash !== null) return NODE_NAME_TAKEN[clash](next);
		setDraft((current) => renameNode(current, node.id, next));
		setSelection({ kind: "node", id: next });
		return null;
	};

	const renameSelectedOutcome =
		(node: FlowNode) => (index: number, name: string) => {
			setDraft((current) => renameOutcome(current, node.id, index, name));
			return null;
		};

	// Dropping a label drops its edges too: say so, and offer to put them back.
	const removeSelectedOutcome = (node: FlowNode) => (index: number) => {
		const result = removeOutcome(draft, node.id, index);
		const { option, dropped } = result;
		if (!option) return;
		setDraft((current) => removeOutcome(current, node.id, index).flow);
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
						setDraft((current) =>
							restoreOutcome(current, node.id, index, option, dropped),
						),
				},
			},
		);
	};

	// Own outcomes on or off: edges on outcomes the node drops go too, with an undo.
	const setSelectedCallEach =
		(node: FlowNode) => (each: CallEach | undefined) => {
			const result = setCallEach(draft, node.id, each);
			setDraft((current) => setCallEach(current, node.id, each).flow);
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
							setDraft((current) =>
								restoreCallEach(current, node.id, previous, dropped),
							),
					},
				},
			);
		};

	const setSelectedAgentOutcomes =
		(node: FlowNode) => (outcomes: NodeOption[] | undefined) => {
			const result = setAgentOutcomes(draft, node.id, outcomes);
			setDraft((current) => setAgentOutcomes(current, node.id, outcomes).flow);
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
							setDraft((current) =>
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
