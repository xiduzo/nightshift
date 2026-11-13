import type { ValueResult } from "@nightshift/agents/types";
import {
	acceptsValue,
	canMakeValue,
	type JsonValue,
	renderTemplate,
	type ValueNode,
	type ValueTier,
	valueDecider,
} from "@nightshift/flows";
import { type Climb, trailData } from "../../cascade";
import { isWaitKind, type StepContext, stepFailure } from "../../context";
import { deciderCostSource, warnDeciderCost } from "../../cost";
import { schemaProblem } from "../../output-schema";
import { RESUME_RULES } from "../../resume-point";
import { type BodyResult, runStep, type StepHandle } from "../../step-runner";
import { withinGrace } from "../choosers/model";
import {
	endWithoutValue,
	endWithValue,
	type Producer,
	valueOutputs,
} from "./producer";

/**
 * A Value made by a model: the node's decider (`Decider.value`, TanStack
 * AI `chat()` with the output schema on the decider's text adapter) reads
 * the rendered prompt and answers with data. The transcript gets
 * `value-start` (the prompt, the model) and `value` (the data, or why there
 * is none); `StepEnded` carries the decider's cost as `costUsd`.
 *
 * The step lifecycle is the step runner's, with the rules of a Decision
 * decided by a model (`RESUME_RULES.model`): a step that waited continues,
 * one recovery ended after the wake is reopened, anything else is a new
 * visit. A usage limit or a network failure is a wait request; the runner
 * plans the wait and parks at the node's wait node (`wait__<id>`), or ends
 * the step `error` on a give-up. This module is the body: `make`.
 *
 * The model fails, or its data does not match the output schema → `fail`,
 * with why in `note`. No decider, or a decider that cannot make values, or
 * an output schema that is not a valid JSON Schema → `error`.
 */
export function modelProducer(
	node: ValueNode,
	ctx: StepContext,
	/**
	 * A try of a cascade (ADR 6): `node` is its tier's node. Data that
	 * matches holds only when the tier's `accept` rule holds too; else the
	 * try ends `fail`, and the node climbs.
	 */
	climb?: Climb<ValueTier>,
): Producer {
	return (state, config) =>
		runStep(ctx, node, state, config, {
			rules: RESUME_RULES.model,
			outputs: (step) => valueOutputs("", null, "", step.visit),
			body: async (step) => {
				const made = await make(node, step);
				return climb ? accepted(made, climb.tier, step) : made;
			},
			...(climb ? { climb } : {}),
		});
}

/**
 * The tier's `accept` rule, tested on data that matched: data it refuses,
 * or that it fails on, ends the try `fail` with why in `note`.
 */
async function accepted(
	made: BodyResult,
	tier: ValueTier,
	step: StepHandle,
): Promise<BodyResult> {
	const rule = tier.accept?.trim() ?? "";
	if (made.kind !== "end" || made.outcome !== "pass" || rule === "") {
		return made;
	}
	let why: string | null = null;
	try {
		if (!(await acceptsValue(rule, made.outputs.data as JsonValue))) {
			why = `The value does not pass the accept rule of the tier: ${rule}`;
		}
	} catch (error) {
		why = `The accept rule of the tier failed: ${error instanceof Error ? error.message : String(error)}`;
	}
	if (why === null) return made;
	step.record(null, { type: "value", data: null, problem: why });
	return {
		...made,
		outcome: "fail",
		outputs: {
			...made.outputs,
			...valueOutputs("fail", null, why, step.visit),
		},
	};
}

/**
 * Asks the decider and ends the step on its answer, or asks for a wait.
 * An end the model answered keeps its answer for a cascade's trail.
 */
async function make(node: ValueNode, step: StepHandle): Promise<BodyResult> {
	const { visit, signal } = step;
	const prompt = renderTemplate(node.prompt ?? "", step.tctx);
	const fail = (error: string): BodyResult => ({
		kind: "end",
		outcome: "error",
		outputs: valueOutputs("error", null, "", visit),
		error,
	});
	const decider = (await step.device.capabilities()).decider;
	if (!decider?.values) {
		return fail("No decider is configured for Value nodes.");
	}
	// A node that names no decider runs on Night Shift's Decider of this
	// Device, when its person chose one that makes values. The Device says
	// which text model a node without one starts on.
	const chosen =
		node.decider === undefined ? decider.builtin?.decider : undefined;
	const own = chosen && canMakeValue(chosen.decider) ? chosen : undefined;
	const maker = own?.decider ?? valueDecider(node);
	const model = node.model ?? own?.model ?? decider.defaultModels[maker].value;
	const address = node.address ?? own?.address;
	step.record(null, {
		type: "value-start",
		by: "model",
		source: prompt,
		model,
	});
	const invalid = schemaProblem(node.output);
	if (invalid !== null) return fail(invalid);
	const ask = () =>
		step.device.decide({
			decider: maker,
			prompt,
			output: node.output,
			model,
			...(address !== undefined ? { address } : {}),
			signal,
		});
	const result = await withinGrace(
		() =>
			ask().catch(
				(error): ValueResult => ({
					kind: "error",
					errorKind: "harness",
					message: stepFailure(error, `the decider of node "${node.id}"`),
					costUsd: null,
				}),
			),
		signal,
		() => lateResult("The decider did not stop when Night Shift asked it to."),
	);
	const cost = {
		costUsd: result.costUsd,
		costSource: deciderCostSource(result),
	};
	await warnDeciderCost(step, cost.costSource, "value", model);
	if (signal.aborted) {
		return {
			kind: "aborted",
			outputs: valueOutputs("", null, "", visit),
			...cost,
		};
	}
	if (result.kind === "error") {
		if (isWaitKind(result.errorKind)) {
			return {
				kind: "wait",
				reason: result.errorKind,
				message: result.message,
				resetAt: null,
				harnessSessionId: null,
				...cost,
			};
		}
		return endWithoutValue(step, `The model failed: ${result.message}`, cost);
	}
	// The model's answer, before it is held to the schema: the person tier's
	// form starts with the best one.
	return {
		...(await endWithValue(step, node, result.data, "", cost)),
		trail: trailData(result.data as JsonValue),
	};
}

function lateResult(message: string): ValueResult {
	return { kind: "error", errorKind: "aborted", message, costUsd: null };
}
