import {
	type ConvertNode,
	convertDataShape,
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
import { dataProblem, schemaProblem } from "../../output-schema";
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
 * the value is too big, does not fit its format, or its data does not
 * match the schema: the node's own `output` when a person wrote or
 * confirmed it, else the format's own shape (`convertDataShape`). An
 * `output` that is not a valid JSON Schema is the flow's mistake: `error`.
 */
export function convertNode(node: ConvertNode, ctx: StepContext): NodeAction {
	return (state, config) =>
		runStep(ctx, node, state, config, {
			rules: RESUME_RULES.fresh,
			outputs: (step) => convertOutputs("", step.visit),
			body: async (step) => convertStep(node, step),
		});
}

/** The Convert kind: the plain facts. It needs no computer, so it never waits for one. */
export const CONVERT: NodeKind<ConvertNode> = {
	...PLAIN_KIND,
	type: "convert",
	make: convertNode,
	resumeRules: () => RESUME_RULES.fresh,
};

function convertStep(node: ConvertNode, step: StepHandle): BodyEnd {
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
	const schema = schemaOf(node);
	const invalid = schemaProblem(schema);
	if (invalid !== null) {
		record(invalid);
		return {
			kind: "end",
			outcome: "error",
			outputs: convertOutputs("error", step.visit, { note: invalid }),
			error: invalid,
		};
	}
	let made: Converted;
	try {
		made = convertValue(node, value);
	} catch (error) {
		if (error instanceof ConvertProblem) return fail(error.message);
		throw error;
	}
	if (made.kind === "data") {
		const problem = dataProblem(schema, made.data);
		if (problem !== null) {
			return fail(`The data does not match the output schema: ${problem}.`);
		}
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

/**
 * What the data must match: the node's own `output` when a person wrote
 * or confirmed it, else the shape of the format it reads.
 */
function schemaOf(node: ConvertNode): Record<string, unknown> {
	return node.output !== undefined && node.outputInferred !== true
		? node.output
		: convertDataShape(node);
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
