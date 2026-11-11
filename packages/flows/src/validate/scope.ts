import type { Flow, FlowNode } from "../flow";
import { CASCADE_TEMPLATE_FIELDS } from "../nodes";
import { RESERVED_DATA_KEYS, schemaAt } from "../shapes";
import {
	ruleNames,
	ruleProblem,
	ruleVariableNames,
	type TemplateRef,
	templateRefs,
} from "../template";
import type { At, ProjectFlowMap, Report } from "./issues";
import {
	readsName,
	type TemplateField,
	type TemplateScope,
} from "./template-scope";

/** The references of templates and rules: what they may read, and the checks of each one. */

/** What a template may refer to. */
export type Scope = {
	flow: Flow;
	nodes: ReadonlyMap<string, FlowNode>;
	/** Undefined when the project's flows are not known. */
	flows: ProjectFlowMap | undefined;
	/** What a template may read (`templateScope`). */
	template: TemplateScope;
	/** The variables a template or a rule read so far, for the unused-variable warning. */
	readVars: Set<string>;
	/** The node whose templates are checked has a cascade: it reads `{{cascade.*}}` (ADR 6). */
	cascade?: boolean;
	/**
	 * Reports a warning: a path below a JSON field that its shape lacks
	 * (`checkShapePath`). A flow with warnings still runs.
	 */
	warning: Report;
};

/**
 * A rule (a JSONata expression) must be valid, and read only known names
 * (`checkRuleReads`), or a name of `also`. `subject` starts each message.
 */
export function checkRule(
	expr: string,
	subject: string,
	at: At,
	scope: Scope,
	error: Report,
	also: readonly string[] = [],
): void {
	const problem = ruleProblem(expr);
	if (problem !== null) {
		error(`${subject} is not valid: ${problem}`, at);
		return;
	}
	checkRuleReads(expr, subject, at, scope, error, also);
}

/**
 * A rule over a signal's data must be valid and read only `event`, the
 * name the data has (`event.body.check_suite.conclusion = "success"`), as
 * in the rules of a webhook schedule.
 */
export function checkEventRule(
	expr: string,
	subject: string,
	at: At,
	error: Report,
): void {
	const problem = ruleProblem(expr);
	if (problem !== null) {
		error(`${subject} is not valid: ${problem}`, at);
		return;
	}
	for (const name of ruleNames(expr)) {
		if (name !== "event") {
			error(
				`${subject} reads "${name}", but it can only read the signal as event: event.body.action = "completed".`,
				at,
			);
		}
	}
}

/**
 * A rule over the value a model made must be valid and read only `data`
 * (`$count(data.tasks) > 0`): the `accept` rule of a cascade tier (ADR 6).
 */
export function checkDataRule(
	expr: string,
	subject: string,
	at: At,
	error: Report,
): void {
	const problem = ruleProblem(expr);
	if (problem !== null) {
		error(`${subject} is not valid: ${problem}`, at);
		return;
	}
	for (const name of ruleNames(expr)) {
		if (name !== "data") {
			error(
				`${subject} reads "${name}", but it can only read the value as data: $count(data.tasks) > 0.`,
				at,
			);
		}
	}
}

/**
 * The names a rule reads: `run`, `vars`, an input or a node at the top,
 * and a variable the flow has below `vars`.
 */
function checkRuleReads(
	expr: string,
	subject: string,
	at: At,
	scope: Scope,
	error: Report,
	also: readonly string[] = [],
): void {
	for (const name of ruleNames(expr)) {
		if (!also.includes(name) && !readsName(scope.template, name)) {
			error(
				`${subject} reads "${name}", but there is no node or input "${name}".`,
				at,
			);
		}
	}
	const variables = new Set((scope.template.vars ?? []).map((v) => v.name));
	for (const name of ruleVariableNames(expr)) {
		scope.readVars.add(name);
		if (!variables.has(name)) {
			error(
				`${subject} reads vars.${name}, but the flow has no variable "${name}".`,
				at,
			);
		}
	}
}

/**
 * Each reference names `run`, an input, `vars` or a node, and reads what
 * the template scope (`templateScope`) lists: one of its fields first, and
 * deeper keys only below a JSON field. Deeper keys that the field's shape
 * lacks are a warning (`checkShapePath`).
 */
export function checkTemplate(
	text: string,
	subject: string,
	at: At,
	scope: Scope,
	error: Report,
): void {
	for (const ref of templateRefs(text)) {
		checkRef(ref, `${subject} uses ${ref.raw}`, at, scope, error);
	}
}

/** One reference of a template. `uses` starts each message. */
export function checkRef(
	ref: TemplateRef,
	uses: string,
	at: At,
	scope: Scope,
	error: Report,
): void {
	const readable = scope.template;
	const [field, ...deeper] = ref.path;
	if (ref.name === "run") {
		const fields = readable.run.map((run) => run.name);
		if (field === undefined || !fields.includes(field)) {
			error(
				`${uses}, but the run has no field ${field === undefined ? "there" : `"${field}"`}. Use one of: ${fields.join(", ")}.`,
				at,
			);
		} else if (deeper.length > 0) {
			error(`${uses}, but run.${field} is text: it takes no path.`, at);
		}
		return;
	}

	if (ref.name === "vars" && readable.vars !== null) {
		const variable = readable.vars.find((v) => v.name === field);
		if (field === undefined) {
			error(`${uses}, but vars needs a variable: {{vars.<name>}}.`, at);
		} else if (variable === undefined) {
			error(`${uses}, but the flow has no variable "${field}".`, at);
		} else {
			scope.readVars.add(field);
			if (deeper.length > 0 && !variable.json) {
				const type =
					scope.flow.variables?.find((v) => v.name === field)?.type ?? "text";
				error(
					`${uses}, but the variable "${field}" is ${type}: it takes no path. Write {{vars.${field}}}, or make it json.`,
					at,
				);
			} else {
				checkShapePath(variable, deeper, uses, at, scope, false);
			}
		}
		return;
	}

	if (ref.name === "cascade" && !readsName(readable, ref.name)) {
		checkCascadeRef(ref, uses, at, scope, error);
		return;
	}

	const input = readable.inputs.find(
		(candidate) => candidate.name === ref.name,
	);
	if (input !== undefined) {
		if (!input.json && field !== undefined) {
			error(
				`${uses}, but the input "${ref.name}" is text: it takes no path. Write {{${ref.name}}}, or make it a json input.`,
				at,
			);
		}
		return;
	}

	const node = readable.nodes.find((candidate) => candidate.id === ref.name);
	if (node === undefined) {
		error(`${uses}, but there is no node or input "${ref.name}".`, at);
		return;
	}
	// A Subflow node whose flow is not known yet: the call reports that.
	if (node.open) return;
	const fields = node.fields.map((candidate) => candidate.name);
	const read = node.fields.find((candidate) => candidate.name === field);
	if (field === undefined) {
		error(
			`${uses}, but a node needs a field: {{${ref.name}.<field>}}. Use one of: ${fields.join(", ")}.`,
			at,
		);
	} else if (read === undefined) {
		error(
			scope.nodes.get(ref.name)?.type === "command" && field === "data"
				? `${uses}, but the command node "${ref.name}" prints text. Write JSON to $NS_OUTPUT in its command, or set its output to JSON, to read data.`
				: `${uses}, but "${ref.name}" has no field "${field}". Use one of: ${fields.join(", ")}.`,
			at,
		);
	} else if (deeper.length > 0 && !read.json) {
		error(`${uses}, but ${ref.name}.${field} is text: it takes no path.`, at);
	} else {
		checkShapePath(read, deeper, uses, at, scope, field === "data");
	}
}

/**
 * A path below a JSON field that its shape lacks is a warning: the value
 * may still hold it, and a node's shape can be inferred from one run. A
 * shape that does not say (`{}`, no properties, `anyOf`) takes any path.
 * Below a node's `data`, the keys a command writes for Night Shift
 * (`RESERVED_DATA_KEYS`) never warn.
 */
function checkShapePath(
	field: TemplateField,
	deeper: readonly string[],
	uses: string,
	at: At,
	scope: Scope,
	data: boolean,
): void {
	if (deeper.length === 0 || !field.json || field.schema === undefined) return;
	const reserved: readonly string[] = RESERVED_DATA_KEYS;
	if (data && reserved.includes(deeper[0] ?? "")) return;
	const found = schemaAt(field.schema, deeper);
	if (found.kind !== "missing") return;
	const place = [field.ref, ...deeper.slice(0, found.index)].join(".");
	const key = deeper[found.index];
	scope.warning(
		found.keys.length > 0
			? `${uses}, but ${place} has no field "${key}". Use one of: ${found.keys.join(", ")}.`
			: `${uses}, but the shape of ${place} has no field "${key}".`,
		at,
	);
}

/**
 * `{{cascade.tier}}`, `{{cascade.try}}` and `{{cascade.previous}}`: only a
 * node with a cascade reads them, and only `previous` takes a path.
 */
function checkCascadeRef(
	ref: TemplateRef,
	uses: string,
	at: At,
	scope: Scope,
	error: Report,
): void {
	const [field, ...deeper] = ref.path;
	if (!scope.cascade) {
		error(
			`${uses}, but only a node with a cascade can read cascade. Add a cascade to the node, or remove the reference.`,
			at,
		);
		return;
	}
	const fields: readonly string[] = CASCADE_TEMPLATE_FIELDS;
	if (field === undefined || !fields.includes(field)) {
		error(
			`${uses}, but the cascade has no field ${field === undefined ? "there" : `"${field}"`}. Use one of: ${fields.join(", ")}.`,
			at,
		);
	} else if (deeper.length > 0 && field !== "previous") {
		error(`${uses}, but cascade.${field} takes no path.`, at);
	}
}

export function describeNode(node: FlowNode): string {
	return node.type === "agent" && node.outcomes === undefined
		? `a ${node.type} node`
		: `"${node.id}"`;
}
