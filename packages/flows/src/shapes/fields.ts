import type {
	Flow,
	FlowInputDef,
	FlowNode,
	FlowNodeType,
	FlowOutputDef,
	FlowVariableDef,
	outputFieldsByType,
} from "../flow";
import {
	type callEachOutputFields,
	type cascadeOutputFields,
	commandHasData,
	type confidenceField,
} from "../nodes";
import { convertDataShape } from "./convert";

/**
 * The shape of each output field a later node reads (`{{check.exit_code}}`),
 * as JSON Schema. `{}` is any JSON value: a template may take any path
 * below it. A node's own `output` schema types one of its fields
 * (`TYPED_OUTPUT_FIELD`).
 */

type Schema = Record<string, unknown>;

const text: Schema = { type: "string" };
const whole: Schema = { type: "integer" };
const number: Schema = { type: "number" };
const anything: Schema = {};

type FieldShapes<T extends FlowNodeType> = Record<
	(typeof outputFieldsByType)[T][number],
	Schema
>;

/** The shape of each output field, per node type, before a node's own `output` schema. */
export const OUTPUT_FIELD_SHAPES: { [T in FlowNodeType]: FieldShapes<T> } = {
	agent: {
		outcome: text,
		output: text,
		summary: text,
		data: anything,
		note: text,
		visit: whole,
		session_id: text,
	},
	command: {
		outcome: text,
		exit_code: whole,
		log_tail: text,
		data: anything,
		visit: whole,
	},
	decision: { outcome: text, note: text, visit: whole },
	call: {
		outcome: text,
		ended: text,
		end_message: text,
		end_report: text,
		visit: whole,
	},
	value: { outcome: text, data: anything, note: text, visit: whole },
	wait: {
		outcome: text,
		waited_minutes: number,
		log_tail: text,
		data: anything,
		visit: whole,
	},
	tool: { outcome: text, data: anything, text, visit: whole },
	end: { outcome: text, message: text, report: text, visit: whole },
	join: { outcome: text, data: { type: "object" }, visit: whole },
	lease: {
		outcome: text,
		name: text,
		holder: text,
		holder_title: text,
		waited_minutes: number,
		visit: whole,
	},
	service: { outcome: text, data: anything, log_tail: text, visit: whole },
	"since-last-run": { outcome: text, data: sinceData(false), visit: whole },
	convert: { outcome: text, data: anything, text, note: text, visit: whole },
	"web-request": {
		outcome: text,
		status: whole,
		headers: { type: "object", additionalProperties: text },
		body: anything,
		visit: whole,
	},
};

/** The data of a Since last run node: the new and changed items, and with a value also `previous` and `current`. */
function sinceData(value: boolean): Schema {
	const properties: Record<string, Schema> = {
		new: { type: "array" },
		changed: { type: "array" },
		same_count: whole,
		first_run: { type: "boolean" },
	};
	if (value) {
		properties.previous = anything;
		properties.current = anything;
	}
	return { type: "object", properties };
}

/** The fields of a Call node with `each`. */
const CALL_EACH_FIELD_SHAPES: Record<
	(typeof callEachOutputFields)[number],
	Schema
> = {
	outcome: text,
	done_count: whole,
	failed_count: whole,
	blocked_count: whole,
	waiting_count: whole,
	summary: text,
	results: {
		type: "array",
		items: {
			type: "object",
			properties: {
				id: text,
				title: text,
				state: text,
				reason: text,
				outputs: { type: "object" },
			},
		},
	},
	visit: whole,
};

/** The fields a cascade adds to its node's step (ADR 6). */
const CASCADE_FIELD_SHAPES: Record<
	(typeof cascadeOutputFields)[number] | typeof confidenceField,
	Schema
> = { tier: text, tries: whole, confidence: number };

/**
 * The output field that a node's own `output` schema types: the data of
 * an Agent's report, of a Value, of a command, of a tool, of a conversion
 * to JSON. A node type not listed has no `output` schema.
 */
export const TYPED_OUTPUT_FIELD = {
	agent: "data",
	value: "data",
	command: "data",
	tool: "data",
	convert: "data",
	"web-request": "body",
} as const satisfies Partial<Record<FlowNodeType, string>>;

/**
 * Keys that a node's data may hold whatever its schema says: a command
 * writes `outcome` to pick an exit, and a command, an agent or a value
 * writes `scores` to score the run. A path that starts with one never warns.
 */
export const RESERVED_DATA_KEYS = ["outcome", "scores"] as const;

/** A node's own `output` schema, and the output field it types (`typedOutput`). */
export type TypedOutput = {
	/** The output field the schema types: `data`. */
	field: string;
	/** Undefined: the node has no schema yet. */
	schema: Schema | undefined;
	/** Night Shift inferred the schema from a run, and no person confirmed it. */
	inferred: boolean;
};

/**
 * The `output` schema of `node`, for a node type that has one
 * (`TYPED_OUTPUT_FIELD`), else null. A schema that a person wrote or
 * confirmed holds a run to it. An inferred one only warns.
 */
export function typedOutput(node: FlowNode): TypedOutput | null {
	const field: string | undefined =
		TYPED_OUTPUT_FIELD[node.type as keyof typeof TYPED_OUTPUT_FIELD];
	if (field === undefined) return null;
	if (node.type === "convert") {
		// To text there is no data. To JSON, the format's own shape holds when
		// the node names none: Night Shift wrote it, so it counts as written,
		// and Night Shift infers nothing for a Convert node.
		if (node.to !== "json") return null;
		return {
			field,
			schema: node.output ?? convertDataShape(node),
			inferred: node.output !== undefined && node.outputInferred === true,
		};
	}
	const own = node as { output?: Schema; outputInferred?: true };
	return {
		field,
		schema: own.output,
		inferred: own.output !== undefined && own.outputInferred === true,
	};
}

/**
 * The output field that holds what a node made or found: the field a new
 * node that takes a value reads (`addNodeAfter`). The field its own
 * `output` schema types, when the node has data. Else the field that says
 * the most: an Agent's final message, a command's last lines, a Gate's
 * note, the holder of a Lease.
 */
export function mainOutputField(node: FlowNode): string {
	switch (node.type) {
		case "agent":
			return node.output !== undefined ? "data" : "output";
		case "command":
			return commandHasData(node) ? "data" : "log_tail";
		case "convert":
			return node.to === "json" ? "data" : "text";
		case "value":
		case "tool":
		case "join":
		case "service":
		case "since-last-run":
			return "data";
		case "web-request":
			return "body";
		case "decision":
			return "note";
		case "call":
			return node.each !== undefined ? "results" : "end_message";
		case "wait":
			return node.until.kind === "command"
				? "log_tail"
				: node.until.kind === "duration" || node.until.kind === "time"
					? "waited_minutes"
					: "data";
		case "lease":
			return "holder";
		case "end":
			return "message";
	}
}

/**
 * The shape of one output field of `node`, by its name: the node's own
 * `output` schema for its typed field, else the field's shape. A field of
 * the flow a Call node calls takes that output's shape (`flowOutputShape`).
 * Undefined for a name the node does not have.
 */
export function outputFieldShape(
	node: FlowNode,
	field: string,
	called?: Flow | null,
): Schema | undefined {
	if (node.type === "call" && node.each !== undefined) {
		return own(CALL_EACH_FIELD_SHAPES, field);
	}
	if (node.type === "since-last-run" && node.value !== undefined) {
		if (field === "data") return sinceData(true);
	}
	const typed = typedOutput(node);
	if (typed?.field === field && typed.schema !== undefined) {
		return typed.schema;
	}
	// A Convert node's data has the shape of the format it reads.
	if (node.type === "convert" && field === "data") {
		return convertDataShape(node);
	}
	const shape =
		own<Schema>(OUTPUT_FIELD_SHAPES[node.type], field) ??
		own(CASCADE_FIELD_SHAPES, field);
	if (shape !== undefined || node.type !== "call" || !called) return shape;
	const output = called.outputs.find((candidate) => candidate.name === field);
	return output === undefined ? undefined : flowOutputShape(output);
}

/**
 * The shape of a flow output: its `schema` when its type is `json`, else
 * its type. An output without a type holds any JSON value.
 */
export function flowOutputShape(output: FlowOutputDef): Schema {
	if (output.type === undefined) return anything;
	return typeShape(output.type, output.schema);
}

/** The shape of a variable: its type, and its `schema` when it is `json`. */
export function variableShape(variable: FlowVariableDef): Schema {
	return typeShape(variable.type, variable.schema);
}

/** The shape of a flow input: its type, the options of a choice. */
export function inputShape(input: FlowInputDef): Schema {
	switch (input.type) {
		case "choice":
			return input.options && input.options.length > 0
				? { type: "string", enum: [...input.options] }
				: text;
		case "json":
			return anything;
		default:
			return typeShape(input.type);
	}
}

function typeShape(
	type: "text" | "number" | "boolean" | "json",
	schema?: Schema,
): Schema {
	switch (type) {
		case "text":
			return text;
		case "number":
			return number;
		case "boolean":
			return { type: "boolean" };
		case "json":
			return schema ?? anything;
	}
}

function own<T>(record: Record<string, T>, key: string): T | undefined {
	return Object.hasOwn(record, key) ? record[key] : undefined;
}
