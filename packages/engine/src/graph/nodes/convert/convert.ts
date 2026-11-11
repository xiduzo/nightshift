import {
	type ConvertNode,
	DEFAULT_CONVERT_MAX_BYTES,
	type JsonValue,
	renderTemplate,
	renderValue,
	type TemplateContext,
} from "@nightshift/flows";
import type { StepOutputs } from "../../../log";
import {
	type NodeAction,
	type NodeKind,
	PLAIN_KIND,
	type StepContext,
} from "../../context";
import { outputVerdict } from "../../output-schema";
import { RESUME_RULES } from "../../resume-point";
import { type BodyEnd, runStep, type StepHandle } from "../../step-runner";
import { type Converted, convertValue } from "./formats";
import { ConvertProblem } from "./problem";

/**
 * The Convert node: CSV, YAML, XML, a feed or a Markdown table to JSON,
 * JSON back to text, and HTML to text, with the libraries of the format
 * modules beside this file. Pure and quick: no Device, no shell, no
 * model, so it runs on the Walker, a Host without a shell included. The
 * step opens, converts and ends in one go, like a Value by rule.
 *
 * `pass` with `data` (to JSON) or `text`; `fail` with why in `note` when
 * the value is too big or does not fit its format. Data to JSON holds to
 * its schema (`outputVerdict`): the node's own `output`, else the shape
 * its format declares (`typedOutput` of `@nightshift/flows`), which counts
 * as written. Data that does not fit ends the step `fail` (a Shape node),
 * an inferred `output` only warns, and an `output` that is not a valid
 * JSON Schema is the flow's mistake: `error`.
 */
export function convertNode(node: ConvertNode, ctx: StepContext): NodeAction {
	return (state, config) =>
		runStep(ctx, node, state, config, {
			rules: RESUME_RULES.fresh,
			outputs: (step) => convertOutputs("", step.visit),
			body: (step) => convertStep(node, step),
		});
}

/** The Convert kind: the plain facts. It needs no computer, so it never waits for one. */
export const CONVERT: NodeKind<ConvertNode> = {
	...PLAIN_KIND,
	type: "convert",
	make: convertNode,
	resumeRules: () => RESUME_RULES.fresh,
};

async function convertStep(
	node: ConvertNode,
	step: StepHandle,
): Promise<BodyEnd> {
	const value = inputOf(node, step.tctx);
	const bytes = "json" in value ? sizeOf(value.json) : byteLength(value.text);
	const record = (problem: string | null) =>
		step.record(null, {
			type: "convert",
			from: node.from,
			to: node.to,
			bytes,
			problem,
		});
	const fail = (why: string): BodyEnd => {
		record(why);
		return {
			kind: "end",
			outcome: "fail",
			outputs: convertOutputs("fail", step.visit, { note: why }),
			error: null,
		};
	};
	const max = node.maxBytes ?? DEFAULT_CONVERT_MAX_BYTES;
	if (bytes > max) {
		return fail(
			`The value has ${sizeText(bytes)}, and this node reads at most ${sizeText(max)}. Send less, or raise its size limit.`,
		);
	}
	if ("problem" in value) return fail(value.problem);
	let made: Converted;
	try {
		made = convertValue(node, value);
	} catch (error) {
		if (error instanceof ConvertProblem) return fail(error.message);
		throw error;
	}
	if (made.kind === "data") {
		const verdict = outputVerdict(node, made.data);
		if (verdict.kind === "broken") {
			record(verdict.message);
			return {
				kind: "end",
				outcome: verdict.outcome,
				outputs: convertOutputs(verdict.outcome, step.visit, {
					note: verdict.message,
				}),
				error: verdict.outcome === "error" ? verdict.message : null,
			};
		}
		if (verdict.kind === "warning") await step.warn("shape", verdict.message);
	}
	record(null);
	return {
		kind: "end",
		outcome: "pass",
		outputs: convertOutputs(
			"pass",
			step.visit,
			made.kind === "data" ? { data: made.data } : { text: made.text },
		),
		error: null,
	};
}

/**
 * The rendered value. From JSON: a template that is one reference keeps
 * its value, and text is read as JSON. Else the text.
 */
function inputOf(
	node: ConvertNode,
	tctx: TemplateContext,
): { json: JsonValue } | { text: string } | { problem: string; text: string } {
	if (node.from !== "json") return { text: renderTemplate(node.value, tctx) };
	const value = renderValue(node.value, tctx);
	if (typeof value !== "string") return { json: value };
	try {
		return { json: JSON.parse(value) as JsonValue };
	} catch (error) {
		return {
			text: value,
			problem: `The value is not valid JSON: ${error instanceof Error ? error.message : String(error)}.`,
		};
	}
}

function convertOutputs(
	outcome: string,
	visit: number,
	made: { data?: JsonValue; text?: string; note?: string } = {},
): StepOutputs {
	return {
		outcome,
		data: made.data ?? null,
		text: made.text ?? "",
		note: made.note ?? "",
		visit,
	};
}

function byteLength(text: string): number {
	return Buffer.byteLength(text, "utf8");
}

function sizeOf(value: JsonValue): number {
	return byteLength(JSON.stringify(value) ?? "");
}

/** A size a person reads: bytes, KB or MB. */
function sizeText(bytes: number): string {
	if (bytes < 1024) return `${bytes} bytes`;
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
