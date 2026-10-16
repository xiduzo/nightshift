import type { JsonValue } from "./schema";
import type { TemplateContext, TemplateRef } from "./types";

/**
 * Templates: `{{name}}` or `{{name.path.to.value}}`, whitespace inside the
 * braces allowed. `name` matches `[a-z][a-z0-9_]*` (a node id, an input, or
 * `run`); each path key matches `[A-Za-z0-9_-]+` (an object key, or an array
 * index). Anything else between braces is left as it is.
 *
 * Lookup: `run` → `context.run`; an input name → `context.inputs`; a node id
 * → `context.nodes`. A missing value renders as "". A string renders as is,
 * a number or boolean with String(), an object or array as JSON.
 */

/** Every reference in the text, in order. */
export function templateRefs(text: string): TemplateRef[] {
	throw new Error("Not implemented");
}

/** The value a reference points at, or undefined when it is missing. */
export function lookupRef(
	context: TemplateContext,
	ref: Pick<TemplateRef, "name" | "path">,
): JsonValue | undefined {
	throw new Error("Not implemented");
}

/** Replaces each reference with its value as text. */
export function renderTemplate(text: string, context: TemplateContext): string {
	throw new Error("Not implemented");
}

/**
 * Renders a template to a JSON value: a template that is exactly one
 * reference (whitespace around it allowed) keeps the referenced value as it
 * is (undefined → null); any other template renders as text.
 */
export function renderValue(text: string, context: TemplateContext): JsonValue {
	throw new Error("Not implemented");
}

/**
 * The environment variable that carries a reference into a command:
 * `NS_` + name and path keys, upper case, joined by `_`, with any character
 * outside `[A-Z0-9_]` turned into `_`. `{{item.parent.number}}` →
 * `NS_ITEM_PARENT_NUMBER`.
 */
export function templateEnvName(name: string, path: readonly string[]): string {
	throw new Error("Not implemented");
}

/**
 * Renders a shell command. Values never become shell text: an agent's output
 * could hold `$(…)`. Each reference becomes `${NS_…}` and its value (as
 * text) goes in `env`. Quote it like any variable: `echo "{{worker.summary}}"`.
 */
export function renderCommand(
	text: string,
	context: TemplateContext,
): { command: string; env: Record<string, string> } {
	throw new Error("Not implemented");
}
