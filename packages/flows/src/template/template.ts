import type { JsonValue } from "../nodes";
import type { TemplateContext, TemplateRef } from "./context";

/**
 * Templates: `{{name}}` or `{{name.path.to.value}}`, whitespace inside the
 * braces allowed. `name` matches `[a-z][a-z0-9_]*` (a node id, an input, or
 * `run`); each path key matches `[A-Za-z0-9_-]+` (an object key, or an array
 * index). Anything else between braces is left as it is.
 *
 * Lookup: `run` → `context.run`; `vars` → `context.vars` (the flow's
 * variables); an input name → `context.inputs`; a node id → `context.nodes`;
 * `cascade` → `context.cascade`, in the step of a cascade, when no input
 * or node has that name. A missing value renders as "". A string renders as is,
 * a number or boolean with String(), an object or array as JSON.
 */

/**
 * One reference, with the braces: name, then `.key` per path key. Global:
 * read it with `matchAll` (which copies it), never with `test` or `exec`.
 * The web editor marks what it matches, so a marked reference is exactly
 * one that a run fills in.
 */
export const TEMPLATE_REF =
	/\{\{\s*([a-z][a-z0-9_]*)((?:\.[A-Za-z0-9_-]+)*)\s*\}\}/g;

/** A template that is exactly one reference, whitespace around it allowed. */
const ONLY_REF =
	/^\s*\{\{\s*([a-z][a-z0-9_]*)((?:\.[A-Za-z0-9_-]+)*)\s*\}\}\s*$/;

function toRef(raw: string, name: string, keys: string): TemplateRef {
	return { name, path: keys === "" ? [] : keys.slice(1).split("."), raw };
}

/** Every reference in the text, in order. */
export function templateRefs(text: string): TemplateRef[] {
	const refs: TemplateRef[] = [];
	for (const [raw, name, keys] of text.matchAll(TEMPLATE_REF)) {
		if (name !== undefined) refs.push(toRef(raw, name, keys ?? ""));
	}
	return refs;
}

/** The value a reference points at, or undefined when it is missing. */
export function lookupRef(
	context: TemplateContext,
	ref: Pick<TemplateRef, "name" | "path">,
): JsonValue | undefined {
	let value: JsonValue | undefined;
	if (ref.name === "run") value = context.run;
	else if (ref.name === "vars") value = context.vars ?? {};
	else if (Object.hasOwn(context.inputs, ref.name))
		value = context.inputs[ref.name];
	else if (Object.hasOwn(context.nodes, ref.name))
		value = context.nodes[ref.name];
	else if (ref.name === "cascade" && context.cascade !== undefined)
		value = context.cascade;
	for (const key of ref.path) {
		if (value === undefined) return undefined;
		value = child(value, key);
	}
	return value;
}

/** An array element by index, or an object's own key; else undefined. */
function child(value: JsonValue, key: string): JsonValue | undefined {
	if (Array.isArray(value)) {
		return /^(0|[1-9][0-9]*)$/.test(key) ? value[Number(key)] : undefined;
	}
	if (typeof value === "object" && value !== null && Object.hasOwn(value, key))
		return value[key];
	return undefined;
}

/** A value as text: "" when missing or null, JSON for objects and arrays. */
function asText(value: JsonValue | undefined): string {
	if (value === undefined || value === null) return "";
	if (typeof value === "string") return value;
	if (typeof value === "object") return JSON.stringify(value);
	return String(value);
}

/** Replaces each reference with its value as text. */
export function renderTemplate(text: string, context: TemplateContext): string {
	return text.replace(TEMPLATE_REF, (raw: string, name: string, keys: string) =>
		asText(lookupRef(context, toRef(raw, name, keys))),
	);
}

/** Plain values, each as it is when it goes in a Markdown list. */
function isScalar(value: JsonValue): value is string | number | boolean {
	return (
		typeof value === "string" ||
		typeof value === "number" ||
		typeof value === "boolean"
	);
}

/**
 * An object or array as lines of its own: a list of plain values as a
 * Markdown list, anything else as a fenced JSON block. "" when empty.
 * null for any other value.
 */
function asBlock(value: JsonValue | undefined): string | null {
	if (typeof value !== "object" || value === null) return null;
	const entries = Array.isArray(value) ? value : Object.keys(value);
	if (entries.length === 0) return "";
	if (Array.isArray(value) && value.every(isScalar)) {
		return value
			.map((item) => `- ${String(item).replace(/\n/g, "\n  ")}`)
			.join("\n");
	}
	return `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;
}

/** One line of `renderReadable`, or null when all its references are empty. */
function readableLine(line: string, context: TemplateContext): string | null {
	let out = "";
	let last = 0;
	let refs = 0;
	let filled = 0;
	let afterBlock = false;
	for (const match of line.matchAll(TEMPLATE_REF)) {
		const [raw, name = "", keys = ""] = match;
		const literal = line.slice(last, match.index);
		out += afterBlock ? literal.trimStart() : literal;
		last = match.index + raw.length;
		refs++;
		const value = lookupRef(context, toRef(raw, name, keys));
		const block = asBlock(value);
		afterBlock = block !== null && block !== "";
		if (afterBlock) {
			out = `${out.trimEnd()}\n\n${block}\n\n`;
			filled++;
		} else if (block === null) {
			const text = asText(value);
			if (text.trim() !== "") filled++;
			out += text;
		}
	}
	const tail = line.slice(last);
	out += afterBlock ? tail.trimStart() : tail;
	return refs === 0 || filled > 0 ? out : null;
}

/**
 * Renders text a person reads, such as the question of a Gate. As
 * `renderTemplate`, but an object or array never sits inside a sentence:
 * it gets lines of its own (see `asBlock`). A line whose references all
 * render empty is left out, so a step that did not run leaves no
 * "Approver: ." behind.
 */
export function renderReadable(text: string, context: TemplateContext): string {
	const lines: string[] = [];
	for (const line of text.split("\n")) {
		const rendered = readableLine(line, context);
		if (rendered !== null) lines.push(rendered);
	}
	return lines.join("\n").replace(/\n{3,}/g, "\n\n");
}

/** Whether the template is exactly one reference, whitespace around it allowed. */
export function isOnlyRef(text: string): boolean {
	return ONLY_REF.test(text);
}

/**
 * Renders a template to a JSON value: a template that is exactly one
 * reference (whitespace around it allowed) keeps the referenced value as it
 * is (undefined → null); any other template renders as text.
 */
export function renderValue(text: string, context: TemplateContext): JsonValue {
	const only = ONLY_REF.exec(text);
	if (only?.[1] !== undefined) {
		return lookupRef(context, toRef(only[0], only[1], only[2] ?? "")) ?? null;
	}
	return renderTemplate(text, context);
}

/**
 * The environment variable that carries a reference into a command:
 * `NS_` + name and path keys, upper case, joined by `_`, with any character
 * outside `[A-Z0-9_]` turned into `_`. `{{item.parent.number}}` →
 * `NS_ITEM_PARENT_NUMBER`.
 */
export function templateEnvName(name: string, path: readonly string[]): string {
	return `NS_${[name, ...path]
		.join("_")
		.toUpperCase()
		.replace(/[^A-Z0-9_]/g, "_")}`;
}

/**
 * Renders a shell command. Values never become shell text: an agent's output
 * could hold `$(…)`. Each reference becomes `${NS_…}` and its value (as
 * text) goes in `env`. Quote it like any variable: `echo "{{worker.summary}}"`.
 *
 * One variable per distinct reference: the same reference twice shares one.
 * Two references that map to the same name (`{{a.b_c}}` and `{{a.b.c}}`)
 * get `_2`, `_3`, … on the later ones.
 */
export function renderCommand(
	text: string,
	context: TemplateContext,
): { command: string; env: Record<string, string> } {
	const env: Record<string, string> = {};
	/** Env name by reference key (name and path). */
	const names = new Map<string, string>();
	const command = text.replace(
		TEMPLATE_REF,
		(raw: string, name: string, keys: string) => {
			const ref = toRef(raw, name, keys);
			const key = [ref.name, ...ref.path].join(".");
			let envName = names.get(key);
			if (envName === undefined) {
				const base = templateEnvName(ref.name, ref.path);
				envName = base;
				for (let n = 2; Object.hasOwn(env, envName); n++)
					envName = `${base}_${n}`;
				names.set(key, envName);
				env[envName] = asText(lookupRef(context, ref));
			}
			return `\${${envName}}`;
		},
	);
	return { command, env };
}
