import { z } from "zod";
import type { JsonValue } from "./base";

/**
 * An Ask (ADR 10): a Value made by a person. The form comes from the
 * node's output schema, so the web, the phone, the engine and the checks
 * all read the schema the same way here. This file holds no schema
 * validator: the phone runs no code that compiles one. The engine holds
 * the answer to the full schema; `formDataProblem` checks the subset that
 * a form can fill in.
 */

/**
 * What a field of the form is: a string is `text`, an `enum` a `choice`,
 * an array of `enum` (`items.enum`) a `choices`, a boolean a `switch`, a
 * number or an integer a `number`. Any other field is `other`: the phone
 * then opens the form on the web.
 */
export type AskFieldKind =
	| "text"
	| "choice"
	| "choices"
	| "switch"
	| "number"
	| "other";

/** One field of an Ask's form, as the schema gives it. */
export type AskField = {
	name: string;
	/** The schema's `title`, else the name. */
	label: string;
	/** The schema's `description`: the hint under the field. */
	hint?: string;
	kind: AskFieldKind;
	required: boolean;
	/** A `choice` or `choices`: the values of the `enum`. */
	options: string[];
	/** A `number` that must be whole (`type: "integer"`). */
	integer: boolean;
};

/** A file or a link an Ask shows, as the form keeps it. */
export type AskAttachment = {
	/** What the person sees: the author's label, else the file name or the link. */
	label: string;
	/** A file the run keeps: the artifact's id. */
	artifactId?: string;
	/** A file's media type: `image/png` shows inline. */
	mediaType?: string;
	/** A link that opens in the browser. */
	url?: string;
};

/** One choice of an Ask that the run gave: its name is the value the answer holds. */
export type AskChoice = {
	name: string;
	label: string;
	description?: string;
	attachments?: AskAttachment[];
};

/**
 * The form of an Ask, as the Gate opens with it (`GateOpened.form`): the
 * schema the answer must match (the node's output, with the run's choices
 * as the `enum` of their field), the choices with their labels, the Ask's
 * attachments, the data the form starts with, and the data the deadline
 * takes.
 */
export type AskForm = {
	schema: { [key: string]: JsonValue };
	choices?: { field: string; items: AskChoice[] };
	attachments?: AskAttachment[];
	/** The data the form starts with: the best answer of the models of a cascade. */
	prefill?: JsonValue;
	/** The data the deadline takes. Unset: the deadline ends the step `fail`. */
	default?: JsonValue;
};

const askAttachmentSchema = z.object({
	label: z.string(),
	artifactId: z.string().optional(),
	mediaType: z.string().optional(),
	url: z.string().optional(),
});

const askChoiceSchema = z.object({
	name: z.string(),
	label: z.string(),
	description: z.string().optional(),
	attachments: z.array(askAttachmentSchema).optional(),
});

/** An Ask's form on the wire and in the checkpoint. */
export const askFormSchema: z.ZodType<AskForm> = z.object({
	schema: z.record(z.string(), z.json()),
	choices: z
		.object({ field: z.string(), items: z.array(askChoiceSchema) })
		.optional(),
	attachments: z.array(askAttachmentSchema).optional(),
	prefill: z.json().optional(),
	default: z.json().optional(),
}) as z.ZodType<AskForm>;

/** The one choice of an Ask's Gate: the answer is the form's data, not an option. */
export const ASK_ANSWER = "answer";

/**
 * A file of the run's copy of the project (`path`) or a link (`url`) that
 * an Ask, or one of its choices, shows. Both may hold templates.
 */
export interface AttachmentSource {
	path?: string;
	url?: string;
	label?: string;
}

export const attachmentSourceSchema: z.ZodType<AttachmentSource> = z.object({
	path: z.string().optional(),
	url: z.string().optional(),
	label: z.string().trim().min(1).max(80).optional(),
});

/**
 * One item of the list that `choices.from` renders: the name the answer
 * holds, the label the person reads, and what helps them choose.
 */
export const choiceItemSchema = z.object({
	name: z.string().trim().min(1).max(200),
	label: z.string().trim().min(1).max(200),
	description: z.string().max(4000).optional(),
	attachments: z.array(attachmentSourceSchema).max(10).optional(),
});
export type ChoiceItem = z.infer<typeof choiceItemSchema>;

type Schema = { [key: string]: unknown };

const isRecord = (value: unknown): value is Schema =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/** The `properties` of an object schema, or none. */
function propertiesOf(schema: Schema): [string, Schema][] {
	const properties = schema.properties;
	if (!isRecord(properties)) return [];
	return Object.entries(properties).flatMap(([name, field]) =>
		isRecord(field) ? [[name, field] as [string, Schema]] : [],
	);
}

/** The schema's one `type`: `["string", "null"]` reads as `string`. */
function typeOf(field: Schema): string | null {
	const { type } = field;
	if (typeof type === "string") return type;
	if (Array.isArray(type)) {
		const own = type.filter((one) => one !== "null");
		return own.length === 1 && typeof own[0] === "string" ? own[0] : null;
	}
	return null;
}

/** The values of an `enum` of strings, or null. */
function enumOf(field: Schema): string[] | null {
	const values = field.enum;
	if (!Array.isArray(values) || values.length === 0) return null;
	return values.every((value) => typeof value === "string")
		? (values as string[])
		: null;
}

/** What a field of the schema is in the form. */
function kindOf(field: Schema): AskFieldKind {
	const type = typeOf(field);
	if (enumOf(field) !== null && (type === "string" || type === null)) {
		return "choice";
	}
	switch (type) {
		case "string":
			return "text";
		case "boolean":
			return "switch";
		case "number":
		case "integer":
			return "number";
		case "array": {
			const items = field.items;
			return isRecord(items) && enumOf(items) !== null ? "choices" : "other";
		}
		default:
			return "other";
	}
}

/** The fields of an Ask's form, in the order of the schema's `properties`. */
export function askFields(schema: Schema): AskField[] {
	const required = new Set(
		Array.isArray(schema.required)
			? schema.required.filter((name) => typeof name === "string")
			: [],
	);
	return propertiesOf(schema).map(([name, field]) => {
		const kind = kindOf(field);
		const items = isRecord(field.items) ? field.items : {};
		const options =
			kind === "choice"
				? (enumOf(field) ?? [])
				: kind === "choices"
					? (enumOf(items) ?? [])
					: [];
		return {
			name,
			label:
				typeof field.title === "string" && field.title.trim() !== ""
					? field.title
					: name,
			...(typeof field.description === "string" &&
			field.description.trim() !== ""
				? { hint: field.description }
				: {}),
			kind,
			required: required.has(name),
			options,
			integer: typeOf(field) === "integer",
		};
	});
}

/**
 * Whether the phone can fill in the form itself: at least one field, and
 * every field text, a choice, a choice of several, a switch or a number.
 */
export function isSimpleForm(schema: Schema): boolean {
	const fields = askFields(schema);
	return fields.length > 0 && fields.every((field) => field.kind !== "other");
}

/**
 * The schema with the run's choices as the `enum` of `field`: a string
 * field becomes a choice, an array of strings a choice of several. Every
 * other field stays.
 */
export function withChoices(
	schema: { [key: string]: JsonValue },
	field: string,
	names: readonly string[],
): { [key: string]: JsonValue } {
	const properties = isRecord(schema.properties) ? schema.properties : {};
	const own = properties[field];
	if (!isRecord(own)) return schema;
	const values = [...names];
	const next =
		typeOf(own) === "array"
			? {
					...own,
					items: {
						...(isRecord(own.items) ? own.items : {}),
						type: "string",
						enum: values,
					},
				}
			: { ...own, type: "string", enum: values };
	return {
		...schema,
		properties: { ...properties, [field]: next } as JsonValue,
	};
}

/**
 * Why a field of the schema cannot hold the run's choices, or null: it
 * must exist, and be a string or an array of strings.
 */
export function choicesFieldProblem(
	schema: Schema,
	field: string,
): string | null {
	const own = propertiesOf(schema).find(([name]) => name === field)?.[1];
	if (own === undefined) return "missing";
	const type = typeOf(own);
	if (type === "string") return null;
	if (type === "array") {
		const items = isRecord(own.items) ? own.items : null;
		const itemType = items === null ? null : typeOf(items);
		if (itemType === "string" || (items !== null && enumOf(items) !== null)) {
			return null;
		}
	}
	return "type";
}

/** Why one value does not fit a field, or null. */
function fieldProblem(field: AskField, value: unknown): string | null {
	switch (field.kind) {
		case "text":
			return typeof value === "string" ? null : "must be text";
		case "choice":
			return typeof value === "string" &&
				(field.options.length === 0 || field.options.includes(value))
				? null
				: `must be one of: ${field.options.join(", ")}`;
		case "choices":
			return Array.isArray(value) &&
				value.every(
					(one) => typeof one === "string" && field.options.includes(one),
				)
				? null
				: `must be a list of: ${field.options.join(", ")}`;
		case "switch":
			return typeof value === "boolean" ? null : "must be true or false";
		case "number":
			if (typeof value !== "number" || !Number.isFinite(value)) {
				return "must be a number";
			}
			return field.integer && !Number.isInteger(value)
				? "must be a whole number"
				: null;
		case "other":
			return null;
	}
}

/**
 * Why `data` does not fit the form, or null: it is an object, it has
 * every required field, and each field it has fits its kind. The engine
 * holds the answer to the full schema; this is what a form and the
 * checks of a `default` can tell.
 */
export function formDataProblem(schema: Schema, data: unknown): string | null {
	if (!isRecord(data)) return "The answer must be an object.";
	for (const field of askFields(schema)) {
		const value = data[field.name];
		if (value === undefined || value === null) {
			if (field.required) return `"${field.label}" needs an answer.`;
			continue;
		}
		const problem = fieldProblem(field, value);
		if (problem !== null) return `"${field.label}" ${problem}.`;
	}
	return null;
}
