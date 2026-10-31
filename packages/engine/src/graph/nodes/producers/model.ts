import type { ValueResult } from "@nightshift/agents/types";
import {
	acceptsValue,
	type JsonValue,
	renderTemplate,
	type ValueNode,
	type ValueTier,
	valueDecider,
} from "@nightshift/flows";
import type { StepOutputs } from "../../../log";
import {
	type Climb,
	climbOutputs,
	climbSpec,
	climbValues,
	trailData,
} from "../../cascade";
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
	return (state, config) => {
		// The model's answer of this try, for the person tier's form.
		let answered: JsonValue | undefined;
		return runStep(ctx, node, state, config, {
			rules: RESUME_RULES.model,
			outputs: (step) => ({
				...valueOutputs("", null, "", step.visit),
				...(climb ? climbOutputs(climb.root, climb.at) : {}),
			}),
			body: async (step) => {
				const made = await make(node, step, climb, (data) => {
					answered = data;
				});
				return climb ? withClimb(made, climb, step) : made;
			},
			...(climb
				? {
						climb: climbSpec(climb.root, climb.at, () => trailData(answered)),
					}
				: {}),
		});
	};
}

/**
 * A try's end with the climb's fields, and the tier's `accept` rule
 * tested on data that matched: data it refuses, or that it fails on, ends
 * the try `fail` with why in `note`.
 */
async function withClimb(
	made: BodyResult,
	climb: Climb<ValueTier>,
	step: StepHandle,
): Promise<BodyResult> {
	if (made.kind !== "end" && made.kind !== "aborted") return made;
	const outputs: StepOutputs = {
		...made.outputs,
		...climbOutputs(climb.root, climb.at),
	};
	const rule = climb.tier.accept?.trim() ?? "";
	if (made.kind !== "end" || made.outcome !== "pass" || rule === "") {
		return { ...made, outputs };
	}
	let why: string | null = null;
	try {
		if (!(await acceptsValue(rule, outputs.data as JsonValue))) {
			why = `The value does not pass the accept rule of the tier: ${rule}`;
		}
	} catch (error) {
		why = `The accept rule of the tier failed: ${error instanceof Error ? error.message : String(error)}`;
	}
	if (why === null) return { ...made, outputs };
	step.record(null, { type: "value", data: null, problem: why });
	return {
		...made,
		outcome: "fail",
		outputs: { ...outputs, ...valueOutputs("fail", null, why, step.visit) },
	};
}

/** Asks the decider and ends the step on its answer, or asks for a wait. */
async function make(
	node: ValueNode,
	step: StepHandle,
	climb?: Climb<ValueTier>,
	/** The model answered with this data, before it is held to the schema. */
	onAnswer?: (data: JsonValue) => void,
): Promise<BodyResult> {
	const { visit, signal } = step;
	if (climb) step.tctx.cascade = climbValues(climb.root, climb.at);
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
	// The Device says which text model a node without one starts on.
	const maker = valueDecider(node);
	const model = node.model ?? decider.defaultModels[maker].value;
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
			...(node.address !== undefined ? { address: node.address } : {}),
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
	onAnswer?.(result.data as JsonValue);
	return endWithValue(step, node, result.data, "", cost);
}

function lateResult(message: string): ValueResult {
	return { kind: "error", errorKind: "aborted", message, costUsd: null };
}
