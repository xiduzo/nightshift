/** Renames in templates, rules and expressions. */
import { type Flow, type FlowNode, mapNodeTexts } from "../flow";
import { mapTexts, type NodeText, type TextRewrite } from "../nodes";
import type { TemplateRef } from "../template";
import {
	rewriteRuleNames,
	rewriteRuleVariables,
	templateRefs,
} from "../template";

/** A name a template can reference: a node id, an input, `run` or `vars`. */
const REF_NAME = /^[a-z][a-z0-9_]*$/;
/** A key of a reference's path. */
const REF_KEY = /^[A-Za-z0-9_-]+$/;

/**
 * Rewrites the references in a template that `rename` gives a new text for.
 * Everything else stays as it is.
 */
export function rewriteRefs(
	text: string,
	rename: (ref: TemplateRef) => string | undefined,
): string {
	let out = "";
	let cursor = 0;
	for (const ref of templateRefs(text)) {
		// The references come in order and do not overlap.
		const at = text.indexOf(ref.raw, cursor);
		out += text.slice(cursor, at) + (rename(ref) ?? ref.raw);
		cursor = at + ref.raw.length;
	}
	return out + text.slice(cursor);
}

/**
 * The rewrite for a name that no template can reference. The editor passes
 * only valid names. For any other name, the result stays as it was before
 * the rewrite used `templateRefs`: `from` goes into the pattern as it is.
 */
function rewriteByPattern(
	text: string,
	prefix: string,
	from: string,
	to: string,
): string {
	const reference = new RegExp(
		`(\\{\\{\\s*${prefix})${from}(?=(?:\\.[A-Za-z0-9_-]+)*\\s*\\}\\})`,
		"g",
	);
	return text.replace(reference, `$1${to}`);
}

/**
 * Rewrites the references to `from` in a template: `{{from}}`,
 * `{{ from.path.to }}`. Other names that start the same stay.
 */
export function renameRefs(text: string, from: string, to: string): string {
	if (!REF_NAME.test(from)) return rewriteByPattern(text, "", from, to);
	return rewriteRefs(text, (ref) => {
		if (ref.name !== from) return undefined;
		const at = ref.raw.indexOf(from);
		return ref.raw.slice(0, at) + to + ref.raw.slice(at + from.length);
	});
}

/**
 * Rewrites the references to the variable `from` in a template:
 * `{{vars.from}}`, `{{ vars.from.path }}`.
 */
export function renameVarRefs(text: string, from: string, to: string): string {
	if (!REF_KEY.test(from)) return rewriteByPattern(text, "vars\\.", from, to);
	return rewriteRefs(text, (ref) => {
		if (ref.name !== "vars" || ref.path[0] !== from) return undefined;
		const at = ref.raw.indexOf("vars") + "vars.".length;
		return ref.raw.slice(0, at) + to + ref.raw.slice(at + from.length);
	});
}

/**
 * Rewrites the name `from` where a rule or an expression reads it at the
 * top: `from.data.x`, `` `from`.data ``. A string, a `$` variable, a key
 * below another name and the rule's own names (`also`: `previous`,
 * `current`) stay. A rule that is not valid stays as it is. So does a
 * rule whose own name `to` is: it would read its own value, not the
 * node, so the old name stays for the check to show.
 */
function renameInRule(
	text: string,
	from: string,
	to: string,
	also: readonly string[] = [],
): string {
	if (also.includes(from) || also.includes(to)) return text;
	return rewriteRuleNames(text, (name) => (name === from ? to : undefined));
}

/**
 * Renames `from` in every template and rule of the flow
 * (`rewriteFlowTexts`): `{{from…}}` in a template, `from` at the top of a
 * rule.
 */
export function renameInFlow(flow: Flow, from: string, to: string): Flow {
	return rewriteFlowTexts(flow, (text, field) =>
		field.kind === "rule"
			? renameInRule(text, from, to, field.also)
			: renameRefs(text, from, to),
	);
}

/**
 * Rewrites `vars.from` where a rule or an expression reads the variable
 * (`rewriteRuleVariables`): `vars.from`, `$$.vars.from`. A string, a name
 * that only starts the same (`vars.from_2`) and a key below another value
 * (`$x.vars.from`) stay. A rule that is not valid stays as it is.
 */
export function renameVarInRule(
	text: string,
	from: string,
	to: string,
): string {
	return rewriteRuleVariables(text, (name) => (name === from ? to : undefined));
}

/**
 * Renames a variable, its `{{vars.old…}}` references in this flow's
 * templates, `vars.old` in its rules and expressions, and the writes to it.
 */
export function renameVariable(flow: Flow, index: number, to: string): Flow {
	const from = flow.variables?.[index]?.name;
	if (from === undefined || from === to) return flow;
	const renamed = rewriteFlowTexts(flow, (text, field) =>
		field.kind === "rule"
			? renameVarInRule(text, from, to)
			: renameVarRefs(text, from, to),
	);
	return {
		...renamed,
		nodes: renamed.nodes.map((node) =>
			node.set === undefined
				? node
				: {
						...node,
						set: node.set.map((write) =>
							write.variable === from ? { ...write, variable: to } : write,
						),
					},
		),
		variables: (renamed.variables ?? []).map((variable, at) =>
			at === index ? { ...variable, name: to } : variable,
		),
	};
}

/**
 * Renames an input, the `{{old…}}` references in this flow's nodes and
 * outputs, and `old` where its rules read it. Flows that call this one
 * keep binding the old name.
 */
export function renameInput(flow: Flow, index: number, to: string): Flow {
	const from = flow.inputs[index]?.name;
	if (from === undefined || from === to) return flow;
	const next = renameInFlow(flow, from, to);
	return {
		...next,
		inputs: next.inputs.map((input, at) =>
			at === index ? { ...input, name: to } : input,
		),
	};
}

/** Applies `rewrite` to every template of the node, not its rules (`mapNodeTexts`). */
export function rewriteTemplates(
	node: FlowNode,
	rewrite: (text: string) => string,
): FlowNode {
	return mapNodeTexts(node, (text, field) =>
		field.kind === "rule" ? text : rewrite(text),
	);
}

/** The texts of the flow outside its nodes: its outputs and the initial values of its variables. */
const FLOW_TEXTS: readonly NodeText[] = [
	{ at: "outputs[].value" },
	{ at: "variables[].initial" },
];

/**
 * Applies `rewrite` to every text of the flow that can read a name: its
 * nodes' (`mapNodeTexts`), its outputs, and the initial values of its
 * variables.
 */
export function rewriteFlowTexts(flow: Flow, rewrite: TextRewrite): Flow {
	const nodes = flow.nodes.map((node) => mapNodeTexts(node, rewrite));
	return mapTexts({ ...flow, nodes }, FLOW_TEXTS, rewrite);
}
