import {
	type DecisionNode,
	type DecisionTier,
	type PersonTier,
	personTierIndex,
	renderReadable,
} from "@nightshift/flows";
import {
	climbAt,
	climbLines,
	climbOutputs,
	climbValues,
	tierAt,
} from "../cascade";
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
import { type Chooser, decisionOutputs, gateChoices } from "./choosers/chooser";
import { modelChooser } from "./choosers/model";
import { gateAskNode, gateChooser, personChooser } from "./choosers/person";
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
	if (node.cascade !== undefined) return climbingDecision(node, ctx);
	return chooserFor(node, ctx);
}

/**
 * A Decision with a cascade (ADR 6): each try asks the model of its tier
 * (`choosers/model.ts` with the climb), and a pick below the tier's
 * `minConfidence` goes to the next try. The person tier is a Gate that
 * shows each tier's pick and probability; its answer ends the step on
 * the option (`gateAskNode`).
 */
function climbingDecision(node: DecisionNode, ctx: StepContext): NodeAction {
	return (state, config) => {
		const at = climbAt(state, node);
		const tier = tierAt(node, at);
		if (tier === null) {
			throw new Error(
				`Decision node "${node.id}" has no tier ${at.tier + 1} in its cascade.`,
			);
		}
		if (tier.kind === "person") {
			return gateChooser(node, ctx, {
				question: (tctx) =>
					climbQuestion(
						renderReadable(node.prompt, {
							...tctx,
							cascade: climbValues(node, at),
						}),
						at.trail,
					),
				choices: gateChoices(node),
				deadline: tier.tier.deadline,
				outputs: climbOutputs(node, at),
				climb: true,
			})(state, config);
		}
		return modelChooser(tier.node as DecisionNode, ctx, {
			root: node,
			at,
			tier: tier.tier as DecisionTier,
		})(state, config);
	};
}

/** The question of a Decision's person tier: its prompt, then what each tier picked. */
function climbQuestion(
	prompt: string,
	trail: Parameters<typeof climbLines>[0],
): string {
	if (trail.length === 0) return prompt;
	return `${prompt}\n\nThe models were not sure enough:\n${climbLines(trail)}`;
}

/** Whether the Decision ends its cascade with a person: a Gate, so an ask node. */
function asksAtTheTop(node: DecisionNode): PersonTier | null {
	const index = personTierIndex(node);
	return index === null ? null : (node.cascade?.[index] as PersonTier);
}

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
			? asksAtTheTop(node)
				? [{ kind: "wait" }, { kind: "ask", make: gateAskNode }]
				: [{ kind: "wait" }]
			: node.by === "person"
				? [{ kind: "ask", make: gateAskNode }]
				: [],
	// Every option; a cascade with no tier that held ends on `fail`.
	isChosenEnd: (node, outcome) =>
		node.options.some((option) => option.name === outcome),
	endReason: (node, outcome) =>
		outcome === "pass" ? null : endedAtReason(node, outcome),
	endedLabel: (_node, outcome) => outcome,
	timeBudget: (node) => ({
		// A Gate waits as long as it must.
		timeoutMinutes: node.by === "person" ? undefined : node.timeoutMinutes,
		idleMinutes: undefined,
	}),
	cutShortOutputs: (open, _node, outcome) =>
		decisionOutputs(outcome, "", open.visit),
	requirements: [modelDecisionsHaveDecider],
};
