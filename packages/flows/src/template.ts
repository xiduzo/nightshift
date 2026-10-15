import type { TemplateContext, TemplateRef } from "./types";

const REF = /\{\{\s*([a-z][a-z0-9_]*)\.([a-z][a-z0-9_]*)\s*\}\}/g;

/** Every `{{scope.field}}` in the text, in order. Whitespace inside braces is allowed. */
export function templateRefs(text: string): TemplateRef[] {
	const refs: TemplateRef[] = [];
	for (const match of text.matchAll(REF)) {
		const [raw, scope, field] = match;
		if (scope !== undefined && field !== undefined) {
			refs.push({ scope, field, raw });
		}
	}
	return refs;
}

function lookup(
	context: TemplateContext,
	scope: string,
	field: string,
): string {
	const source: Record<string, string | number> | undefined =
		scope === "run"
			? context.run
			: Object.hasOwn(context.nodes, scope)
				? context.nodes[scope]
				: undefined;
	if (!source || !Object.hasOwn(source, field)) return "";
	const value = source[field];
	return value === undefined || value === null ? "" : String(value);
}

/** Replaces each reference with its value. Unknown or missing values render as "". */
export function renderTemplate(text: string, context: TemplateContext): string {
	return text.replace(REF, (_raw, scope: string, field: string) =>
		lookup(context, scope, field),
	);
}

/** The environment variable that carries `{{scope.field}}` into a command. */
export function templateEnvName(scope: string, field: string): string {
	return `NS_${scope.toUpperCase()}_${field.toUpperCase()}`;
}

/**
 * Renders a shell command. Values never become shell text: an agent's output
 * could hold `$(…)`. Each reference becomes `${NS_SCOPE_FIELD}` and its value
 * goes in `env`. Quote it like any variable: `echo "{{worker.summary}}"`.
 */
export function renderCommand(
	text: string,
	context: TemplateContext,
): { command: string; env: Record<string, string> } {
	const env: Record<string, string> = {};
	const command = text.replace(REF, (_raw, scope: string, field: string) => {
		const name = templateEnvName(scope, field);
		env[name] = lookup(context, scope, field);
		return `\${${name}}`;
	});
	return { command, env };
}
