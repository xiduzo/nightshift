import type { TemplateContext, TemplateRef } from "./types";

/** Every `{{scope.field}}` in the text, in order. Whitespace inside braces is allowed. */
export function templateRefs(text: string): TemplateRef[] {
	throw new Error("Not implemented");
}

/** Replaces each reference with its value. Unknown or missing values render as "". */
export function renderTemplate(text: string, context: TemplateContext): string {
	throw new Error("Not implemented");
}
