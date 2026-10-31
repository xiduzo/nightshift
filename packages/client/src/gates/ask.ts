import {
	type AskAttachment,
	type AskField,
	type AskForm,
	askFields,
	formDataProblem,
	type JsonValue,
} from "@nightshift/flows";

/**
 * An Ask (ADR 10): a Gate whose answer is a form drawn from the node's
 * output schema. The web and the phone fill it in the same way: the
 * values a form starts with, the options of a choice, and the data an
 * answer sends.
 */

/**
 * What a field holds while a person fills it in: text for a text field, a
 * number field and a field the form cannot draw (JSON), one name for a
 * choice, the names for a choice of several, and on or off for a switch.
 */
export type AskValue = string | boolean | string[];
export type AskValues = Record<string, AskValue>;

/** One option of a choice: a name of the run's choices with its label and attachments, or a name of the schema's `enum`. */
export type AskOption = {
	name: string;
	label: string;
	description?: string;
	attachments?: AskAttachment[];
};

/** The fields of the form, in the order of the schema. */
export function askFormFields(form: AskForm): AskField[] {
	return askFields(form.schema);
}

/** The options of a choice field: the run's choices for their field, else the `enum`. */
export function askOptions(form: AskForm, field: AskField): AskOption[] {
	if (form.choices?.field === field.name) return form.choices.items;
	return field.options.map((name) => ({ name, label: name }));
}

const isRecord = (value: unknown): value is Record<string, JsonValue> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/** What a field starts with: the pre-filled data when it fits, else empty (a switch off). */
function startValue(field: AskField, given: JsonValue | undefined): AskValue {
	switch (field.kind) {
		case "text":
			return typeof given === "string" ? given : "";
		case "number":
			return typeof given === "number" ? String(given) : "";
		case "choice":
			return typeof given === "string" && field.options.includes(given)
				? given
				: "";
		case "choices":
			return Array.isArray(given)
				? given.filter(
						(one): one is string =>
							typeof one === "string" && field.options.includes(one),
					)
				: [];
		case "switch":
			return given === true;
		case "other":
			return given === undefined ? "" : JSON.stringify(given, null, 2);
	}
}

/** The values a form starts with: the best answer of the models, where it fits each field. */
export function askStartValues(form: AskForm): AskValues {
	const prefill = isRecord(form.prefill) ? form.prefill : {};
	return Object.fromEntries(
		askFormFields(form).map((field) => [
			field.name,
			startValue(field, prefill[field.name]),
		]),
	);
}

/** One field's value as data, undefined when it is empty, or why it is not valid. */
function dataOf(
	field: AskField,
	value: AskValue | undefined,
): { data: JsonValue | undefined } | { problem: string } {
	switch (field.kind) {
		case "switch":
			return { data: value === true };
		case "choices":
			return { data: Array.isArray(value) ? value : [] };
		case "number": {
			const text = typeof value === "string" ? value.trim() : "";
			if (text === "") return { data: undefined };
			const number = Number(text);
			return Number.isFinite(number)
				? { data: number }
				: { problem: `"${field.label}" must be a number.` };
		}
		case "other": {
			const text = typeof value === "string" ? value.trim() : "";
			if (text === "") return { data: undefined };
			try {
				return { data: JSON.parse(text) as JsonValue };
			} catch {
				return { problem: `Check the format of "${field.label}".` };
			}
		}
		default: {
			const text = typeof value === "string" ? value : "";
			return { data: text.trim() === "" ? undefined : text };
		}
	}
}

/**
 * The data an answer sends, or why the form is not ready: a field that
 * needs an answer, or a value of the wrong kind. Night Shift checks the
 * data against the whole schema again.
 */
export function askAnswerOf(
	form: AskForm,
	values: AskValues,
): { data: Record<string, JsonValue> } | { problem: string } {
	const data: Record<string, JsonValue> = {};
	for (const field of askFormFields(form)) {
		const own = dataOf(field, values[field.name]);
		if ("problem" in own) return own;
		if (own.data !== undefined) data[field.name] = own.data;
	}
	const problem = formDataProblem(form.schema, data);
	return problem === null ? { data } : { problem };
}
