import type { FlowInputDef, FlowNode, FlowVariableDef } from "../../flow";
import { jsonOutputFields } from "../../flow";
import { reservedNames, ruleOwnNames, templateOwnNames } from "../../nodes";
import type { SubflowChange, SubflowInputSource } from "./plan";
import {
	CALL_FIELDS,
	claim,
	isCallRunField,
	nameFrom,
	type Planner,
} from "./planner";

/**
 * What the new flow takes: its names, the inputs the Call binds, and the
 * variables it keeps.
 */

/** The names the new flow and the caller have taken, and the id of the Call. */
export function subflowNames(plan: Planner) {
	const { flow, options } = plan;
	// Names of the new flow: its nodes, inputs and variables share one
	// namespace. A new name is not reserved, and not a rule's or a
	// template's own.
	const subTaken = new Set<string>([
		...reservedNames,
		...ruleOwnNames,
		...templateOwnNames,
		...plan.inner.map((node) => node.id),
		// Variables keep their names, so rules and templates inside stay.
		...(flow.variables ?? []).map((variable) => variable.name),
	]);
	const callerTaken = new Set<string>([
		...reservedNames,
		...ruleOwnNames,
		...templateOwnNames,
		...flow.nodes.map((node) => node.id),
		...flow.inputs.map((input) => input.name),
		...(flow.variables ?? []).map((variable) => variable.name),
	]);
	const callId = claim(callerTaken, nameFrom(options.name), 40, "_");
	return { subTaken, callerTaken, callId };
}

/**
 * The inputs of the new flow: what a template inside reads from outside,
 * and the start value of each variable used inside. It adds the inputs to
 * `changes`.
 */
export function subflowInputs(
	plan: Planner,
	subTaken: Set<string>,
	changes: SubflowChange[],
) {
	const { flow, members } = plan;
	// Inputs: the caller's inputs read inside keep their names.
	const inputs: FlowInputDef[] = [];
	const bindings: Record<string, string> = {};
	const inputChanges = new Map<
		string,
		Extract<SubflowChange, { code: "input-added" }>
	>();
	const addInput = (
		key: string,
		def: FlowInputDef,
		binding: string,
		source: SubflowInputSource,
		reader: string,
	): string => {
		const known = inputChanges.get(key);
		if (known) {
			if (!known.readBy.includes(reader)) known.readBy.push(reader);
			return known.input;
		}
		inputs.push(def);
		bindings[def.name] = binding;
		inputChanges.set(key, {
			kind: "info",
			code: "input-added",
			input: def.name,
			type: def.type,
			source,
			readBy: [reader],
		});
		return def.name;
	};
	const callerInputs = new Map(flow.inputs.map((input) => [input.name, input]));
	for (const name of callerInputs.keys()) subTaken.add(name);

	// Variables used inside: read in a template or a rule, or written.
	const variables = new Map(
		(flow.variables ?? []).map((variable) => [variable.name, variable]),
	);
	const usedVars: string[] = [];
	const varUsers = new Map<string, string[]>();
	const useVar = (variable: string, node: string) => {
		if (!variables.has(variable)) return;
		if (!usedVars.includes(variable)) usedVars.push(variable);
		const users = varUsers.get(variable) ?? [];
		if (!users.includes(node)) users.push(node);
		varUsers.set(variable, users);
	};
	const writers = new Map<string, string[]>();
	for (const node of plan.inner) {
		for (const write of node.set ?? []) {
			useVar(write.variable, node.id);
			const list = writers.get(write.variable) ?? [];
			if (!list.includes(node.id)) list.push(node.id);
			writers.set(write.variable, list);
		}
	}

	const innerReads = plan.reads.filter((read) => plan.inside(read.reader));
	const inputOf = new Map<string, string>();
	for (const read of innerReads) {
		const reader = (read.reader as { node: string }).node;
		const [field] = read.path;
		if (read.name === "vars") {
			if (field !== undefined) useVar(field, reader);
			continue;
		}
		if (read.name === "run") {
			if (!read.rule && isCallRunField(field)) {
				const key = `run:${field}`;
				const name =
					inputOf.get(key) ?? claim(subTaken, `run_${field}`, 40, "_");
				inputOf.set(
					key,
					addInput(
						key,
						{ name, type: "text" },
						`{{run.${field}}}`,
						{ kind: "run", field },
						reader,
					),
				);
			}
			continue;
		}
		const callerInput = callerInputs.get(read.name);
		if (callerInput) {
			const key = `input:${read.name}`;
			inputOf.set(
				key,
				addInput(
					key,
					{
						name: callerInput.name,
						type: callerInput.type,
						...(callerInput.options !== undefined && {
							options: callerInput.options,
						}),
						...(callerInput.label !== undefined && {
							label: callerInput.label,
						}),
						...(callerInput.description !== undefined && {
							description: callerInput.description,
						}),
					},
					`{{${callerInput.name}}}`,
					{ kind: "input", input: callerInput.name },
					reader,
				),
			);
			continue;
		}
		const source = plan.byId.get(read.name);
		if (!source || members.has(read.name) || field === undefined) continue;
		// Rules that read outside are blocked: only templates get here.
		const key = `node:${read.name}.${field}`;
		const name =
			inputOf.get(key) ?? claim(subTaken, `${read.name}_${field}`, 40, "_");
		inputOf.set(
			key,
			addInput(
				key,
				{ name, type: holdsJson(source, field) ? "json" : "text" },
				`{{${read.name}.${field}}}`,
				{ kind: "node", node: read.name, field },
				reader,
			),
		);
	}

	// Each variable used inside starts from an input bound to the caller's value.
	const subVariables: FlowVariableDef[] = [];
	const varInput = new Map<string, string>();
	for (const variable of usedVars) {
		const def = variables.get(variable);
		if (!def) continue;
		const key = `var:${variable}`;
		const name = claim(subTaken, `${variable}_in`, 40, "_");
		// A text variable comes as text (trimmed; no value: ""), the others as JSON.
		const type = def.type === "text" ? "text" : "json";
		for (const user of varUsers.get(variable) ?? []) {
			addInput(
				key,
				{ name, type },
				`{{vars.${variable}}}`,
				{ kind: "variable", variable },
				user,
			);
		}
		varInput.set(variable, name);
		const { initial: _, ...rest } = def;
		subVariables.push({ ...rest, initial: `{{${name}}}` });
	}
	changes.push(...inputChanges.values());
	return { inputs, bindings, inputOf, usedVars, writers, subVariables };
}

/** Whether a node's field holds JSON: `data`, `results`, or a Call's flow output. */
function holdsJson(node: FlowNode, field: string): boolean {
	if ((jsonOutputFields as readonly string[]).includes(field)) return true;
	return node.type === "call" && !node.each && !CALL_FIELDS.includes(field);
}
