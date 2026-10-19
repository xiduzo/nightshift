import type { DecisionNode } from "@nightshift/flows";
import type { StepOutputs } from "../../events";
import type { NodeAction, StepContext } from "../context";
import { modelChooser } from "./choosers/model";
import { personChooser } from "./choosers/person";
import { ruleChooser } from "./choosers/rule";

/**
 * The Decision node: one of its options is the step's outcome, and who
 * picks it is `node.by`. The chooser behind the seam gets the option; the
 * step runner (`runStep`) opens, ends and routes the step for it:
 *
 * - `person` (a Gate): `choosers/person.ts` opens the Gate in the log
 *   (`GateOpened`, the Needs-you inbox) and jumps to the node's ask node
 *   (`ask__<id>`), which interrupts until the answer and then routes.
 * - `rule`: `choosers/rule.ts` evaluates each option's `when` in order,
 *   with no session and no cost; pure, so a re-run is safe.
 * - `model`: `choosers/model.ts` asks the decider, and waits out a usage
 *   limit or a network failure at the node's wait node.
 *
 * Every chooser ends its step with `{ outcome, note, visit }` as outputs:
 * the person's note, the model's reasons, or "" for a rule.
 */
export function decisionNode(node: DecisionNode, ctx: StepContext): NodeAction {
	return chooserFor(node, ctx);
}

/**
 * A chooser runs one visit of the node: it opens the step (how depends on
 * who decides), gets the option, ends the step and routes on it, or parks
 * or waits instead. It returns what the graph node returns.
 */
export type Chooser = NodeAction;

function chooserFor(node: DecisionNode, ctx: StepContext): Chooser {
	switch (node.by) {
		case "person":
			return personChooser(node, ctx);
		case "rule":
			return ruleChooser(node, ctx);
		case "model":
			return modelChooser(node, ctx);
	}
}

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
