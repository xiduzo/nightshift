import type { ValueNode, ValueTier } from "@nightshift/flows";
import { climbAt, tierAt } from "../cascade";
import {
	type NodeAction,
	type NodeKind,
	onDevice,
	PLAIN_KIND,
	type Requirement,
	type StepContext,
} from "../context";
import { RESUME_RULES } from "../resume-point";
import { modelProducer } from "./producers/model";
import { askAnswerNode, personProducer } from "./producers/person";
import type { Producer } from "./producers/producer";
import { ruleProducer } from "./producers/rule";

/**
 * The Value node, the twin of the Decision node: a Decision picks a label,
 * a Value makes `data` that matches the node's output schema, and who makes
 * it is `node.by`. The producer behind the seam makes the value; the step
 * runner (`runStep`) opens, ends and routes the step for it:
 *
 * - `rule`: `producers/rule.ts` evaluates the JSONata expression over the
 *   run's values, with no session and no cost; pure, so a re-run is safe.
 * - `model`: `producers/model.ts` asks the decider's text adapter for data
 *   held to the schema, and waits out a usage limit or a network failure at
 *   the node's wait node, like a Decision decided by a model.
 *
 * Every producer ends its step with `{ outcome, data, note, visit }`: `pass`
 * with the data, or `fail` with `data: null` and why in `note` (the
 * expression threw, the model failed, or the result does not match the
 * schema).
 *
 * - `person`: `producers/person.ts` opens an Ask (ADR 10), a Gate with a
 *   form drawn from the output schema, and jumps to the node's ask node,
 *   which ends the step with the answer's data.
 */
export function valueNode(node: ValueNode, ctx: StepContext): NodeAction {
	if (node.cascade !== undefined) return climbingValue(node, ctx);
	return producerFor(node, ctx);
}

/**
 * A Value with a cascade (ADR 6): each try asks the model of its tier
 * (`producers/model.ts` with the climb). Data that does not match the
 * schema, or that the tier's `accept` rule refuses, goes to the next try.
 * No person tier yet: that is an Ask (ADR 10).
 */
function climbingValue(node: ValueNode, ctx: StepContext): NodeAction {
	return (state, config) => {
		const at = climbAt(state, node);
		const tier = tierAt(node, at);
		if (tier?.kind !== "node") {
			throw new Error(
				`Value node "${node.id}" has no model tier ${at.tier + 1} in its cascade.`,
			);
		}
		return modelProducer(tier.node as ValueNode, ctx, {
			root: node,
			at,
			tier: tier.tier as ValueTier,
		})(state, config);
	};
}

function producerFor(node: ValueNode, ctx: StepContext): Producer {
	switch (node.by) {
		case "rule":
			return ruleProducer(node, ctx);
		case "model":
			return modelProducer(node, ctx);
		case "person":
			return personProducer(node, ctx);
	}
}

/** A Value made by a model needs a decider with a text adapter. */
export const modelValuesHaveDecider: Requirement<ValueNode> = (nodes, has) =>
	!has.decider?.values && nodes.some((n) => n.by === "model")
		? `The flow has a Value node made by a model, but no decider is configured${onDevice(has)}.`
		: null;

/**
 * The Value kind: the plain facts, with a wait node and the model's resume
 * rules when a model makes the value, and the decider as a requirement. A
 * person's Ask is a Gate: an ask node, the Gate's resume rules, and no
 * time budget.
 */
export const VALUE: NodeKind<ValueNode> = {
	...PLAIN_KIND,
	type: "value",
	make: valueNode,
	works: (node) => (node.by === "model" ? "device" : null),
	resumeRules: (node) =>
		node.by === "model"
			? RESUME_RULES.model
			: node.by === "person"
				? RESUME_RULES.gate
				: RESUME_RULES.fresh,
	aux: (node) =>
		node.by === "model"
			? [{ kind: "wait" }]
			: node.by === "person"
				? [{ kind: "ask", make: askAnswerNode }]
				: [],
	timeBudget: (node) => ({
		// An Ask waits as long as it must, as a Gate does.
		timeoutMinutes: node.by === "person" ? undefined : node.timeoutMinutes,
		idleMinutes: undefined,
	}),
	requirements: [modelValuesHaveDecider],
};
