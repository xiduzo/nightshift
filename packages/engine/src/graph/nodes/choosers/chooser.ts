import type { DecisionNode } from "@nightshift/flows";
import type { GateChoice, StepOutputs } from "../../../log";
import type { NodeAction } from "../../context";

/*
 * What every chooser of a Decision shares: the seam and the outputs. The
 * Decision node (`decision.ts`) picks a chooser by `node.by`, so this file
 * imports none of them, and none of them imports the Decision node.
 */

/**
 * A chooser runs one visit of the node: it opens the step (how depends on
 * who decides), gets the option, ends the step and routes on it, or parks
 * or waits instead. It returns what the graph node returns.
 */
export type Chooser = NodeAction;

/** The outputs every Decision step ends with. */
export function decisionOutputs(
	outcome: string,
	note: string,
	visit: number,
): StepOutputs {
	return { outcome, note, visit };
}

/** The options as a person, a model or the log sees them: name and description only. */
export function visibleOptions(
	node: DecisionNode,
): { name: string; description?: string }[] {
	return node.options.map((option) =>
		option.description === undefined
			? { name: option.name }
			: { name: option.name, description: option.description },
	);
}

/** The options as a Gate shows them to a person: the visible ones, with their colour. */
export function gateChoices(node: DecisionNode): GateChoice[] {
	return node.options.map(({ name, description, color }) => ({
		name,
		...(description === undefined ? {} : { description }),
		...(color === undefined ? {} : { color }),
	}));
}
