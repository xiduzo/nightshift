/** Renames in templates, rules and expressions. */
import type { Flow, FlowNode } from "../flow";
import type { ListSource } from "../nodes";
import type { TemplateRef } from "../template";
import { templateRefs } from "../template";

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
 * Rewrites `vars.from` in a rule or an expression, best effort: a name
 * that only starts the same (`vars.from_2`) stays.
 */
export function renameVarInRule(
	text: string,
	from: string,
	to: string,
): string {
	const reference = new RegExp(
		`(^|[^A-Za-z0-9_$.])(vars\\.)${from}(?![A-Za-z0-9_])`,
		"g",
	);
	return text.replace(reference, `$1$2${to}`);
}

/**
 * Renames a variable, its `{{vars.old…}}` references in this flow's
 * templates, `vars.old` in its rules and expressions, and the writes to it.
 */
export function renameVariable(flow: Flow, index: number, to: string): Flow {
	const from = flow.variables?.[index]?.name;
	if (from === undefined || from === to) return flow;
	const templated = rewriteFlowTemplates(flow, (text) =>
		renameVarRefs(text, from, to),
	);
	const rule = (text: string) => renameVarInRule(text, from, to);
	const nodes = templated.nodes.map((node): FlowNode => {
		let next: FlowNode = node;
		if (next.type === "decision") {
			next = {
				...next,
				options: next.options.map((option) =>
					option.when === undefined
						? option
						: { ...option, when: rule(option.when) },
				),
			};
		}
		if (next.type === "value" && next.expression !== undefined) {
			next = { ...next, expression: rule(next.expression) };
		}
		if (next.set) {
			next = {
				...next,
				set: next.set.map((write) => ({
					...write,
					variable: write.variable === from ? to : write.variable,
					...(write.expression !== undefined
						? { expression: rule(write.expression) }
						: {}),
				})),
			};
		}
		return next;
	});
	return {
		...templated,
		nodes,
		variables: (templated.variables ?? []).map((variable, at) =>
			at === index ? { ...variable, name: to } : variable,
		),
	};
}

/**
 * Renames an input and the `{{old…}}` references in this flow's nodes and
 * outputs. Flows that call this one keep binding the old name.
 */
export function renameInput(flow: Flow, index: number, to: string): Flow {
	const from = flow.inputs[index]?.name;
	if (from === undefined || from === to) return flow;
	const next = rewriteFlowTemplates(flow, (text) => renameRefs(text, from, to));
	return {
		...next,
		inputs: next.inputs.map((input, at) =>
			at === index ? { ...input, name: to } : input,
		),
	};
}

function rewriteBindings(
	bindings: Record<string, string>,
	rewrite: (text: string) => string,
): Record<string, string> {
	return Object.fromEntries(
		Object.entries(bindings).map(([name, value]) => [name, rewrite(value)]),
	);
}

function rewriteSource(
	source: ListSource,
	rewrite: (text: string) => string,
): ListSource {
	switch (source.kind) {
		case "json":
			return { ...source, value: rewrite(source.value) };
		case "command":
			return { ...source, command: rewrite(source.command) };
	}
}

/**
 * Applies `rewrite` to every template of the node: a prompt, a command, a question, a list source, the bindings
 * of a called flow's inputs, and the values of its variable writes.
 */
export function rewriteTemplates(
	node: FlowNode,
	rewrite: (text: string) => string,
): FlowNode {
	const own = rewriteOwnTemplates(node, rewrite);
	if (!own.set) return own;
	return {
		...own,
		set: own.set.map((write) =>
			write.value === undefined
				? write
				: { ...write, value: rewrite(write.value) },
		),
	};
}

/** The templates of the node's own kind: all but the values of its variable writes. */
export function rewriteOwnTemplates(
	node: FlowNode,
	rewrite: (text: string) => string,
): FlowNode {
	switch (node.type) {
		case "agent":
			return { ...node, prompt: rewrite(node.prompt) };
		case "decision":
			return {
				...node,
				prompt: rewrite(node.prompt),
				...(node.deadline?.at !== undefined
					? { deadline: { ...node.deadline, at: rewrite(node.deadline.at) } }
					: {}),
			};
		case "end":
			return node.message === undefined
				? node
				: { ...node, message: rewrite(node.message) };
		case "command":
			return { ...node, command: rewrite(node.command) };
		case "call":
			return {
				...node,
				inputs: rewriteBindings(node.inputs, rewrite),
				...(node.each
					? {
							each: {
								...node.each,
								source: rewriteSource(node.each.source, rewrite),
							},
						}
					: {}),
			};
		case "value":
			// The expression reads names bare, as a Decision's rules do: not a template.
			return node.prompt === undefined
				? node
				: { ...node, prompt: rewrite(node.prompt) };
		case "wait":
			switch (node.until.kind) {
				case "time":
					return {
						...node,
						until: { ...node.until, at: rewrite(node.until.at) },
					};
				case "command":
					return {
						...node,
						until: { ...node.until, command: rewrite(node.until.command) },
					};
				default:
					return node;
			}
		case "tool":
			return { ...node, arguments: rewriteBindings(node.arguments, rewrite) };
		case "join":
			return node;
	}
}

/**
 * Applies `rewrite` to every template of the flow: its nodes, its outputs,
 * and the initial values of its variables.
 */
export function rewriteFlowTemplates(
	flow: Flow,
	rewrite: (text: string) => string,
): Flow {
	const rewritten: Flow = {
		...flow,
		nodes: flow.nodes.map((node) => rewriteTemplates(node, rewrite)),
		outputs: flow.outputs.map((output) => ({
			...output,
			value: rewrite(output.value),
		})),
	};
	if (!flow.variables) return rewritten;
	return {
		...rewritten,
		variables: flow.variables.map((variable) =>
			variable.initial === undefined
				? variable
				: { ...variable, initial: rewrite(variable.initial) },
		),
	};
}
