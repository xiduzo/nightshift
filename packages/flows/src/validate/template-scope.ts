import {
	type Flow,
	type FlowNode,
	jsonOutputFields,
	nodeOutputFields,
	runsEach,
} from "../document";
import { runFields } from "../template";
import type { ProjectFlowMap } from "./issues";

/**
 * What a template may read in a flow. The checks of a flow and the editor's
 * suggestions both read it, so the editor suggests what the checks accept:
 * a name or field the scope lists passes, any other fails.
 */

/** One field a template can read. */
export type TemplateField = {
	name: string;
	/** The reference without braces: `topic`, `vars.plan`, `plan.data`, `plan.data.tasks`, `run.branch`. */
	ref: string;
	/** Holds JSON: a template may take a path below it. */
	json: boolean;
	/** What the flow file says it holds: an input's description or label, a variable's description, a called flow output's description. */
	description?: string;
	/** An output of the flow a Subflow node calls. */
	output?: boolean;
	/** The keys the node's output schema names below this field, as suggestions. Any path below a JSON field passes. */
	keys?: readonly TemplateField[];
};

/** A node's fields, as `{{id.field}}` reads them. */
export type TemplateNode = {
	id: string;
	fields: readonly TemplateField[];
	/** More fields may exist: a Subflow node whose flow is not known yet. Any field passes then. */
	open: boolean;
};

export type TemplateScope = {
	/** `{{name}}`: the flow's inputs. */
	inputs: readonly TemplateField[];
	/** `{{vars.name}}`: the flow's variables. Null where no template reads them: in a variable's initial value. */
	vars: readonly TemplateField[] | null;
	/** `{{id.field}}`: the nodes, in the flow's order. None in a variable's initial value: no step ran yet. */
	nodes: readonly TemplateNode[];
	/** `{{run.field}}`. */
	run: readonly TemplateField[];
};

export type TemplateScopeOptions = {
	/** The project's flows by name, for the outputs of Subflow nodes. Leave out while they load. */
	flows?: ProjectFlowMap;
	/** The scope of a variable's initial value: the inputs and `run` only. */
	initialValue?: boolean;
};

/**
 * What a template in `flow` may read: its inputs, its variables, each
 * node's output fields, and the run's fields. A Command node has `data`
 * only with `output: "json"`. A Subflow node without `each` adds the
 * outputs of the flow it calls, which hold JSON.
 */
export function templateScope(
	flow: Flow,
	options: TemplateScopeOptions = {},
): TemplateScope {
	const run = runFields.map((name) => ({
		name,
		ref: `run.${name}`,
		json: false,
	}));
	const inputs = flow.inputs.map((input) => ({
		name: input.name,
		ref: input.name,
		json: input.type === "json",
		...described(input.description ?? input.label),
	}));
	if (options.initialValue) return { inputs, vars: null, nodes: [], run };
	const vars = (flow.variables ?? []).map((variable) => ({
		name: variable.name,
		ref: `vars.${variable.name}`,
		json: variable.type === "json",
		...described(variable.description),
	}));
	// The first node with an id wins, as in the checks of a flow.
	const nodes = new Map<string, TemplateNode>();
	for (const node of flow.nodes) {
		if (!nodes.has(node.id)) {
			nodes.set(node.id, templateNode(node, options.flows));
		}
	}
	return { inputs, vars, nodes: [...nodes.values()], run };
}

/** Whether a template or a rule in this scope can read the top-level name `name`. */
export function readsName(scope: TemplateScope, name: string): boolean {
	if (name === "run") return true;
	if (name === "vars") return scope.vars !== null;
	return (
		scope.inputs.some((input) => input.name === name) ||
		scope.nodes.some((node) => node.id === name)
	);
}

function templateNode(
	node: FlowNode,
	flows: ProjectFlowMap | undefined,
): TemplateNode {
	const json: readonly string[] = jsonOutputFields;
	const field = (name: string): TemplateField => ({
		name,
		ref: `${node.id}.${name}`,
		json: json.includes(name),
	});
	if (node.type === "call" && !runsEach(node)) {
		const called = calledFlow(node.flow, flows);
		// Unknown until the flows load, or broken: the Subflow node reports that.
		if (called === undefined) {
			return {
				id: node.id,
				fields: nodeOutputFields(node).map(field),
				open: true,
			};
		}
		const own: readonly string[] = nodeOutputFields(node);
		const fields = nodeOutputFields(node, called).map((name) => {
			if (own.includes(name)) return field(name);
			const output = called.outputs.find(
				(candidate) => candidate.name === name,
			);
			return {
				...field(name),
				json: true,
				output: true,
				...described(output?.description),
			};
		});
		return { id: node.id, fields, open: false };
	}
	const fields = nodeOutputFields(node)
		.filter(
			(name) =>
				!(node.type === "command" && name === "data" && node.output !== "json"),
		)
		.map((name) => {
			const keys =
				name === "data" && (node.type === "agent" || node.type === "value")
					? schemaFields(node.output, `${node.id}.data`)
					: [];
			return keys.length > 0 ? { ...field(name), keys } : field(name);
		});
	return { id: node.id, fields, open: false };
}

/** The flow a Call node calls, by its name: undefined while the flows load, or when it is not known or broken. */
export function calledFlow(
	name: string,
	flows: ProjectFlowMap | undefined,
): Flow | undefined {
	if (flows === undefined || !Object.hasOwn(flows, name)) return undefined;
	return flows[name] ?? undefined;
}

/**
 * The top-level keys of a JSON Schema object, with whether each holds
 * JSON, as fields below the reference `base` (`plan.data`).
 */
export function schemaFields(schema: unknown, base: string): TemplateField[] {
	if (!schema || typeof schema !== "object") return [];
	const properties = (schema as { properties?: unknown }).properties;
	if (!properties || typeof properties !== "object") return [];
	return Object.entries(properties as Record<string, unknown>)
		.filter(([name]) => /^[A-Za-z0-9_-]+$/.test(name))
		.map(([name, field]) => {
			const type =
				field && typeof field === "object"
					? (field as { type?: unknown }).type
					: undefined;
			return {
				name,
				ref: `${base}.${name}`,
				json: type === "array" || type === "object",
			};
		});
}

function described(description: string | undefined): {
	description?: string;
} {
	return description === undefined ? {} : { description };
}
