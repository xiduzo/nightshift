import { isDeepStrictEqual } from "node:util";

/** What a secret value becomes in a command's output, as in an exported run. */
export const SECRET_MASK = "•••";

/** Hides one set of secret values. Made once for what comes back of a job. */
export type SecretMask = {
	/** `text` with every value as `•••`. */
	text(text: string): string;
	/**
	 * A JSON value with every value as `•••`, in each string it holds. A
	 * value that is itself a JSON document goes as a whole, also where it is
	 * written as data. A number stays. `all`: the names of the fields go too.
	 * `values`: the names stay, for an object whose fields a reader knows by
	 * name.
	 */
	json(value: unknown, where?: "all" | "values"): unknown;
	/**
	 * `text` with every value as `•••`, for a reader that takes it as JSON
	 * when it is JSON. Text that is no object, list or string as JSON, so also
	 * JSON that is not valid, is hidden as plain text. Plain hiding is also
	 * enough when the JSON then reads as the hidden data does: the text keeps
	 * its layout. Else the text is the hidden data, written again: without its
	 * layout, and each number as JavaScript reads it, so a very big integer
	 * loses digits (as it does in `data`). A value of digits and the marks of
	 * JSON then stays where it is no string. A value that runs over several
	 * parts of the JSON still goes. JSON too deep to write again is hidden as
	 * plain text.
	 */
	jsonText(text: string): string;
};

/** A value that is JSON: its data, and the strings a text must hold to hold it. */
type Document = { data: object | string; strings: readonly string[] };

/** Every value as it is, and as it appears inside a JSON string: the longest first. */
export function secretForms(values: readonly string[]): string[] {
	return [
		...new Set(
			values.flatMap((value) => (value === "" ? [] : [value, inJson(value)])),
		),
	].sort((a, b) => b.length - a.length);
}

export function secretMask(values: readonly string[]): SecretMask {
	const forms = secretForms(values);
	const across = secretForms(values.filter(runsAcross));
	const documents: Document[] = values.flatMap((value) => {
		const data = jsonIn(value);
		return data === undefined || Object.keys(data).length === 0
			? []
			: [{ data, strings: stringsOf(JSON.stringify(data)) }];
	});
	/** Only what `written` (JSON with the escapes of `JSON.stringify`) can hold. */
	const within = (written: string) => ({
		forms: forms.filter((form) => written.includes(inJson(form))),
		documents: documents.filter(({ strings }) =>
			strings.every((string) => written.includes(string)),
		),
	});
	const json: SecretMask["json"] = (value, where = "all") => {
		let found = { forms, documents };
		try {
			found = within(JSON.stringify(value) ?? "");
		} catch {
			// Too deep to write: every value is looked for.
		}
		return found.forms.length + found.documents.length === 0
			? value
			: hideJson(value, found, where);
	};
	return {
		text: (text) => replaced(text, forms),
		json,
		jsonText(text) {
			const plain = replaced(text, forms);
			const written = withPlainEscapes(text);
			const found = within(written);
			if (plain === text && found.forms.length + found.documents.length === 0) {
				return text;
			}
			const data = jsonIn(text);
			if (data === undefined) return plain;
			try {
				const hidden = hideJson(data, found, "all");
				const read = jsonIn(plain);
				if (read !== undefined && isDeepStrictEqual(read, hidden)) return plain;
				return replaced(JSON.stringify(hidden), across);
			} catch {
				// Too deep to compare or to write.
				return found.documents.length > 0
					? SECRET_MASK
					: replaced(written, forms);
			}
		},
	};
}

/** `text` with every secret value in `values` as `•••`. */
export function redactText(text: string, values: readonly string[]): string {
	return replaced(text, secretForms(values));
}

function replaced(text: string, forms: readonly string[]): string {
	let out = text;
	for (const form of forms) {
		if (form.length <= out.length) out = out.replaceAll(form, SECRET_MASK);
	}
	return out;
}

/** The data with the values hidden. A list of work, not a recursion: any depth passes. */
function hideJson(
	value: unknown,
	found: { forms: readonly string[]; documents: readonly Document[] },
	where: "all" | "values",
): unknown {
	const strings = new Set<unknown>();
	const objects: object[] = [];
	for (const { data } of found.documents) {
		if (typeof data === "string") strings.add(data);
		else objects.push(data);
	}
	const text = (item: string) =>
		strings.has(item) ? SECRET_MASK : replaced(item, found.forms);
	const work: { from: object; to: object }[] = [];
	const hide = (item: unknown): unknown => {
		if (typeof item === "string") return text(item);
		if (typeof item !== "object" || item === null) return item;
		if (objects.some((object) => isSame(object, item))) return SECRET_MASK;
		const to = Array.isArray(item) ? new Array(item.length) : {};
		work.push({ from: item, to });
		return to;
	};
	const out = hide(value);
	for (let next = work.pop(); next; next = work.pop()) {
		const { from, to } = next;
		if (Array.isArray(from)) {
			for (let i = 0; i < from.length; i++) {
				Reflect.set(to, i, hide(from[i]));
			}
			continue;
		}
		for (const [key, field] of Object.entries(from)) {
			const name = where === "all" ? text(key) : key;
			const hidden = hide(field);
			if (name !== "__proto__") Reflect.set(to, name, hidden);
			else {
				Object.defineProperty(to, name, {
					value: hidden,
					enumerable: true,
					configurable: true,
					writable: true,
				});
			}
		}
	}
	return out;
}

function isSame(document: object, item: object): boolean {
	return (
		Array.isArray(document) === Array.isArray(item) &&
		Object.keys(document).length === Object.keys(item).length &&
		isDeepStrictEqual(document, item)
	);
}

/** The object, list or string a text holds as JSON, else nothing. */
function jsonIn(text: string): object | string | undefined {
	try {
		const value: unknown = JSON.parse(text);
		return (typeof value === "object" && value !== null) ||
			typeof value === "string"
			? value
			: undefined;
	} catch {
		return undefined;
	}
}

/** The strings of a JSON text, with their quotes. */
function stringsOf(json: string): readonly string[] {
	return json.match(/"(?:[^"\\]|\\.)*"/g) ?? [];
}

/** A text as it appears inside a JSON string. */
function inJson(text: string): string {
	return JSON.stringify(text).slice(1, -1);
}

/** JSON text with each escape as `JSON.stringify` writes it. */
function withPlainEscapes(text: string): string {
	if (!/\\[u/]/.test(text)) return text;
	return text.replace(/(?:\\u[0-9a-fA-F]{4})+|\\[^u]/g, (part) => {
		if (part === "\\/") return "/";
		return part.startsWith("\\u") ? inJson(JSON.parse(`"${part}"`)) : part;
	});
}

/**
 * Whether a value can run from one part of a JSON text into the next: it
 * has a quote, and more than digits, words and the marks of JSON around it.
 */
function runsAcross(value: string): boolean {
	return (
		value.includes('"') &&
		!/^(?:true|false|null|[-+.\deE\s{}[\],:"])*$/.test(value)
	);
}
