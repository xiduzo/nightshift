import {
	ASK_ANSWER,
	type JsonValue,
	type PersonTier,
	personTierIndex,
	renderTemplate,
	type ValueNode,
} from "@nightshift/flows";
import { type Climb, climbBackground, climbLines } from "../cascade";
import { climbing } from "../climb";
import {
	type NodeAction,
	type NodeKind,
	onDevice,
	PLAIN_KIND,
	type Requirement,
	type StepContext,
} from "../context";
import { dataProblem } from "../output-schema";
import { RESUME_RULES } from "../resume-point";
import type { CascadeTry } from "../state";
import type { GateAsk } from "./choosers/person";
import { modelProducer } from "./producers/model";
import { askAnswerNode, askGate, personProducer } from "./producers/person";
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
	// A Value with a cascade (ADR 6): each try asks the model of its tier
	// (`producers/model.ts` with the climb). Data that does not match the
	// schema, or that the tier's `accept` rule refuses, goes to the next
	// try. The person tier is an Ask (ADR 10): the form starts with the best
	// answer of the models (`bestAnswer`), and its answer ends the step.
	if (node.cascade !== undefined) {
		return climbing(node, ctx, {
			person: (climb) => personTierAsk(node, ctx, climb),
			attempt: (own, climb) => modelProducer(own, ctx, climb),
		});
	}
	return producerFor(node, ctx);
}

/**
 * The Ask of a Value's person tier: the prompt, then what each try did,
 * and a form that starts with the best answer. Its deadline takes that
 * answer (`accept`), or ends the step `fail`.
 */
function personTierAsk(
	node: ValueNode,
	ctx: StepContext,
	{ at, tier }: Climb<PersonTier>,
): GateAsk {
	const best = bestAnswer(node, at.trail);
	const { deadline } = tier;
	return askGate(node, ctx, {
		question: (tctx) => {
			const prompt = renderTemplate(node.prompt ?? "", tctx);
			return at.trail.length === 0
				? prompt
				: `${prompt}\n\nThe models did not make a value that holds:\n${climbLines(at.trail)}`;
		},
		...(best !== undefined ? { prefill: best } : {}),
		...(deadline
			? {
					deadline: { ...deadline, choose: ASK_ANSWER },
					...(deadline.choose === "accept" &&
					best !== undefined &&
					dataProblem(node.output, best) === null
						? { default: best }
						: {}),
				}
			: {}),
		brief: tier,
		known: { background: climbBackground(at.trail) },
	});
}

/**
 * The best answer of the models: the latest that matches the output
 * schema (the `accept` rule of its tier refused it), else the latest
 * answer at all. The form takes only the fields that fit.
 */
export function bestAnswer(
	node: ValueNode,
	trail: readonly CascadeTry[],
): JsonValue | undefined {
	const answers = trail
		.map((done) => done.data)
		.filter((data): data is JsonValue => data !== undefined)
		.reverse();
	return (
		answers.find((data) => dataProblem(node.output, data) === null) ??
		answers[0]
	);
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
			? personTierIndex(node) !== null
				? [{ kind: "wait" }, { kind: "ask", make: askAnswerNode }]
				: [{ kind: "wait" }]
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
