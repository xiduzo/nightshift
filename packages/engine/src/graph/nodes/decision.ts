import type { DecisionNode } from "@nightshift/flows";
import type { StepOutputs } from "../../events";
import {
	endedAtReason,
	type NodeAction,
	type NodeKind,
	onDevice,
	PLAIN_KIND,
	type Requirement,
	type StepContext,
} from "../context";
import { RESUME_RULES, type ResumeRules } from "../resume-point";
import { modelChooser } from "./choosers/model";
import { gateAskNode, personChooser } from "./choosers/person";
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

/** A Decision decided by a model needs the decider. */
export const modelDecisionsHaveDecider: Requirement<DecisionNode> = (
	nodes,
	has,
) =>
	!has.decider && nodes.some((n) => n.by === "model")
		? `The flow has a Decision node decided by a model, but no decider is configured${onDevice(has)}.`
		: null;

/** Which existing step a Decision takes up: the chooser's rule (`RESUME_RULES`). */
function decisionRules(node: DecisionNode): ResumeRules {
	switch (node.by) {
		case "person":
			return RESUME_RULES.gate;
		case "rule":
			return RESUME_RULES.fresh;
		case "model":
			return RESUME_RULES.model;
	}
}

/**
 * The Decision kind. Its facts follow `node.by`: a model gets a wait node,
 * a person an ask node (the Gate), a rule neither. Every option is a
 * chosen end and the label a Call reports; a Gate has no time budget; a
 * stopped Gate ends with an empty note.
 */
export const DECISION: NodeKind<DecisionNode> = {
	...PLAIN_KIND,
	type: "decision",
	make: decisionNode,
	works: (node) => (node.by === "model" ? "device" : null),
	resumeRules: decisionRules,
	aux: (node) =>
		node.by === "model"
			? [{ kind: "wait" }]
			: node.by === "person"
				? [{ kind: "ask", make: gateAskNode }]
				: [],
	isChosenEnd: () => true,
	endReason: (node, outcome) =>
		outcome === "pass" ? null : endedAtReason(node, outcome),
	endedLabel: (_node, outcome) => outcome,
	timeBudget: (node) => ({
		// A Gate waits as long as it must.
		timeoutMinutes: node.by === "person" ? undefined : node.timeoutMinutes,
		idleMinutes: undefined,
	}),
	stoppedOutputs: (open) => decisionOutputs("stopped", "", open.visit),
	requirements: [modelDecisionsHaveDecider],
};

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
