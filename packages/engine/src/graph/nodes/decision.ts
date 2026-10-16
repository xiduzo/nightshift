import type { LangGraphRunnableConfig } from "@langchain/langgraph";
import { Command } from "@langchain/langgraph";
import type { DecisionNode } from "@nightshift/flows";
import type { StepOutputs } from "../../events";
import type { NodeAction, StepContext } from "../context";
import { route, type StepEnd } from "../route";
import type { RunStateValues } from "../state";
import { modelChooser } from "./choosers/model";
import { personChooser } from "./choosers/person";
import { ruleChooser } from "./choosers/rule";

/**
 * The Decision node: one of its options is the step's outcome, and who
 * picks it is `node.by`. The node routes on the step's end (`route()`);
 * the chooser behind the seam gets the option:
 *
 * - `person` (a Gate): `choosers/person.ts` opens the Gate in the log
 *   (`GateOpened`, the Needs-you inbox) and interrupts until the answer.
 * - `rule`: `choosers/rule.ts` evaluates each option's `when` in order,
 *   with no session and no cost; pure, so a re-run is safe.
 * - `model`: `choosers/model.ts` asks the decider, and waits out a usage
 *   limit or a network failure at the node's wait node.
 *
 * Every chooser ends its step with `{ outcome, note, visit }` as outputs:
 * the person's note, the model's reasons, or "" for a rule.
 */
export function decisionNode(node: DecisionNode, ctx: StepContext): NodeAction {
	const choose = chooserFor(node, ctx);
	return async (state, config) => {
		const chosen = await choose(state, config);
		if (chosen instanceof Command) return chosen;
		return route(ctx, state, node, chosen, config);
	};
}

/**
 * A chooser runs one visit of the node: it opens the step (how depends on
 * who decides), gets the option, and ends the step. It returns the step's
 * end to route on, or a Command when the run parks or waits instead.
 */
export type Chooser = (
	state: RunStateValues,
	config: LangGraphRunnableConfig,
) => Promise<StepEnd | Command>;

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
