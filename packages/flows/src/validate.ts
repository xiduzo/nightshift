import { migrateFlow } from "./migrate";
import {
	type Flow,
	type FlowNode,
	type ForEachNode,
	flowSchema,
	jsonOutputFields,
	labelSchema,
	nameSchema,
	nodeOutcomes,
	nodeOutputFields,
	outputFieldsByType,
	reservedNames,
	reservedOutcomes,
	runFields,
	type SubflowNode,
} from "./schema";
import { templateRefs } from "./template";
import type { FlowIssue, ValidateOptions } from "./types";

type At = Pick<FlowIssue, "nodeId" | "edgeId">;
type Report = (message: string, at: At) => void;

/** The flows a check may look up, by name; null when a file does not parse. */
type Flows = Readonly<Record<string, Flow | null>>;

/**
 * Checks what the schema cannot: unique names (node ids and inputs share one
 * namespace, `run` is reserved), a known start node, edges between known
 * nodes with outcomes the source node can produce, an Agent node with a
 * prompt or a skill, outcomes, labels and choices that are unique and not
 * reserved, an Agent output schema that describes an object, template
 * references to known names and fields, outputs, and no cycle without an edge
 * that has a `max` (a Gate in a cycle too: a person could loop forever).
 * Warns about unreachable nodes and about outcomes without an edge, since
 * ending on one ends the run as failed.
 *
 * With `options.flows`, a Subflow or For Each node must call a flow that
 * exists and parses, bind only inputs it declares and every required input
 * it has no default for, and a flow may not call itself through Subflow or
 * For Each nodes. Issues inside a called flow are not repeated: a called
 * flow with errors gives one error on the calling node.
 */
export function validateFlow(
	flow: Flow,
	options: ValidateOptions = {},
): FlowIssue[] {
	return validateIn(flow, options, []);
}

/** `ancestors`: the flows whose calls led here, outermost first. */
function validateIn(
	flow: Flow,
	options: ValidateOptions,
	ancestors: readonly string[],
): FlowIssue[] {
	const issues: FlowIssue[] = [];
	const error: Report = (message, at) =>
		issues.push({ severity: "error", message, ...at });
	const warning: Report = (message, at) =>
		issues.push({ severity: "warning", message, ...at });

	const flows: Flows | undefined =
		options.flows === undefined
			? undefined
			: options.name === undefined
				? options.flows
				: { ...options.flows, [options.name]: flow };

	// Nodes: first occurrence of each id wins.
	const nodes = new Map<string, FlowNode>();
	const reserved: readonly string[] = reservedNames;
	for (const node of flow.nodes) {
		if (nodes.has(node.id)) {
			error(`Node id "${node.id}" is used more than once.`, {
				nodeId: node.id,
			});
			continue;
		}
		nodes.set(node.id, node);
		if (reserved.includes(node.id)) {
			error(
				`Node id "${node.id}" is reserved for {{${node.id}.<field>}} templates.`,
				{ nodeId: node.id },
			);
		}
	}

	checkInputs(flow, nodes, error);

	if (!nodes.has(flow.start)) {
		error(`Start node "${flow.start}" does not exist.`, {
			nodeId: flow.start,
		});
	}

	// Edges.
	const edgeIds = new Set<string>();
	for (const edge of flow.edges) {
		if (edgeIds.has(edge.id)) {
			error(`Edge id "${edge.id}" is used more than once.`, {
				edgeId: edge.id,
			});
		}
		edgeIds.add(edge.id);

		const source = nodes.get(edge.from);
		if (!source) {
			error(`Edge "${edge.id}" leaves unknown node "${edge.from}".`, {
				edgeId: edge.id,
			});
		} else if (!nodeOutcomes(source).includes(edge.outcome)) {
			error(
				`Edge "${edge.id}" leaves "${edge.from}" on "${edge.outcome}", but ${describeNode(source)} ends with ${nodeOutcomes(source).join(", ")}.`,
				{ edgeId: edge.id },
			);
		}
		if (!nodes.has(edge.to)) {
			error(`Edge "${edge.id}" goes to unknown node "${edge.to}".`, {
				edgeId: edge.id,
			});
		}
	}

	// Edges that can never be taken: an earlier edge on the same node and
	// outcome has no max, so the engine always picks that one.
	const unbounded = new Map<string, string>();
	for (const edge of flow.edges) {
		const key = `${edge.from}\u0000${edge.outcome}`;
		const earlier = unbounded.get(key);
		if (earlier !== undefined) {
			warning(
				`Edge "${edge.id}" is never taken: edge "${earlier}" leaves "${edge.from}" on "${edge.outcome}" first and has no max.`,
				{ edgeId: edge.id },
			);
		} else if (edge.max === undefined) {
			unbounded.set(key, edge.id);
		}
	}

	// Node content.
	const scope: Scope = { flow, nodes, flows };
	for (const node of nodes.values()) {
		const at = { nodeId: node.id };
		const template = (text: string, where: string) =>
			checkTemplate(text, `The ${where} of "${node.id}"`, at, scope, error);
		switch (node.type) {
			case "agent":
				if (node.prompt.trim() === "" && node.skill === undefined) {
					error(`Agent node "${node.id}" needs a prompt or a skill.`, at);
				}
				if (node.profile === undefined) {
					const unset = [
						node.harness === undefined ? "harness" : null,
						node.model === undefined ? "model" : null,
						node.permissionMode === undefined ? "permission mode" : null,
					].filter((x) => x !== null);
					if (unset.length > 0) {
						const list =
							unset.length === 1
								? unset[0]
								: `${unset.slice(0, -1).join(", ")} and ${unset.at(-1)}`;
						error(
							`Agent node "${node.id}" needs a profile, or its own ${list}.`,
							at,
						);
					}
				}
				template(node.prompt, "prompt");
				if (node.outcomes !== undefined) {
					checkOptions(node, flow, error, warning);
				}
				if (node.output !== undefined && !isObjectSchema(node.output)) {
					error(
						`The output schema of agent node "${node.id}" must describe an object: give it "type": "object" or "properties".`,
						at,
					);
				}
				break;
			case "command":
				template(node.command, "command");
				break;
			case "decision":
				checkOptions(node, flow, error, warning);
				template(node.prompt, "prompt");
				break;
			case "gate":
				checkOptions(node, flow, error, warning);
				template(node.question, "question");
				break;
			case "subflow":
				for (const [name, value] of Object.entries(node.inputs)) {
					template(value, `input "${name}"`);
				}
				break;
			case "foreach":
				switch (node.source.kind) {
					case "json":
						template(node.source.value, "source value");
						break;
					case "command":
						template(node.source.command, "source command");
						break;
					case "github":
						template(node.source.parent, "source parent");
						break;
					case "files":
						template(node.source.glob, "source glob");
						break;
				}
				for (const [name, value] of Object.entries(node.inputs)) {
					template(value, `input "${name}"`);
				}
				checkHaltOn(node, error);
				break;
		}
	}

	checkOutputs(scope, error);

	// Called flows, when the project's flows are known.
	if (flows !== undefined) {
		const chain =
			options.name === undefined ? ancestors : [...ancestors, options.name];
		for (const node of nodes.values()) {
			if (node.type === "subflow" || node.type === "foreach") {
				checkCall(node, flows, chain, error, warning);
			}
		}
	}

	// Cycles without a max: drop every edge with a max, the rest must be acyclic.
	const bounded = flow.edges.filter(
		(edge) =>
			edge.max === undefined && nodes.has(edge.from) && nodes.has(edge.to),
	);
	for (const cycle of findCycles([...nodes.keys()], bounded)) {
		const path = [...cycle, cycle[0]].join(" → ");
		error(`Loop without a max: ${path}. Give one of its edges a max.`, {
			nodeId: cycle[0],
		});
	}

	// Reachability.
	if (nodes.has(flow.start)) {
		const reached = new Set<string>([flow.start]);
		const queue = [flow.start];
		for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
			for (const edge of flow.edges) {
				if (edge.from === id && nodes.has(edge.to) && !reached.has(edge.to)) {
					reached.add(edge.to);
					queue.push(edge.to);
				}
			}
		}
		for (const id of nodes.keys()) {
			if (!reached.has(id)) {
				warning(`Node "${id}" cannot be reached from the start.`, {
					nodeId: id,
				});
			}
		}
	}

	return issues;
}

/** What a template may refer to. */
type Scope = {
	flow: Flow;
	nodes: ReadonlyMap<string, FlowNode>;
	/** Undefined when the project's flows are not known. */
	flows: Flows | undefined;
};

/**
 * Inputs: unique names, valid and not reserved, not the id of a node, and a
 * `json` default that parses as JSON.
 */
function checkInputs(
	flow: Flow,
	nodes: ReadonlyMap<string, FlowNode>,
	error: Report,
): void {
	const reserved: readonly string[] = reservedNames;
	const seen = new Set<string>();
	for (const input of flow.inputs) {
		const name = input.name;
		if (seen.has(name)) {
			error(`The input "${name}" is declared more than once.`, {});
			continue;
		}
		seen.add(name);
		const valid = nameSchema.safeParse(name);
		if (!valid.success) {
			error(
				`The input "${name}" is not a valid name: ${valid.error.issues[0]?.message ?? "not allowed"}`,
				{},
			);
		} else if (reserved.includes(name)) {
			error(
				`The input "${name}" is reserved for {{${name}.<field>}} templates.`,
				{},
			);
		}
		if (nodes.has(name)) {
			error(
				`The input "${name}" has the same name as node "${name}". Node ids and inputs share one namespace: rename one.`,
				{ nodeId: name },
			);
		}
		if (input.type === "json" && input.default !== undefined) {
			try {
				JSON.parse(input.default);
			} catch {
				error(`The default of the json input "${name}" is not valid JSON.`, {});
			}
		}
	}
}

/** Outputs: unique, valid names that every caller can read, and known templates. */
function checkOutputs(scope: Scope, error: Report): void {
	const seen = new Set<string>();
	const builtIn: readonly string[] = outputFieldsByType.subflow;
	for (const output of scope.flow.outputs) {
		const name = output.name;
		if (seen.has(name)) {
			error(`The output "${name}" is declared more than once.`, {});
			continue;
		}
		seen.add(name);
		const valid = nameSchema.safeParse(name);
		if (!valid.success) {
			error(
				`The output "${name}" is not a valid name: ${valid.error.issues[0]?.message ?? "not allowed"}`,
				{},
			);
		} else if (builtIn.includes(name)) {
			error(
				`The output "${name}" clashes with a field every Subflow node has: ${builtIn.join(", ")}.`,
				{},
			);
		}
		checkTemplate(
			output.value,
			`The value of output "${name}"`,
			{},
			scope,
			error,
		);
	}
}

/**
 * Each reference names `run`, an input, or a node. `run`: one field of
 * `runFields`. A `text` input: no path. A `json` input: any path. A node:
 * one of its output fields first; deeper keys only below a JSON field (and
 * below a Subflow node's flow outputs, which hold JSON).
 */
function checkTemplate(
	text: string,
	subject: string,
	at: At,
	scope: Scope,
	error: Report,
): void {
	const inputs = new Map(scope.flow.inputs.map((input) => [input.name, input]));
	for (const ref of templateRefs(text)) {
		const uses = `${subject} uses ${ref.raw}`;
		const [field, ...deeper] = ref.path;
		if (ref.name === "run") {
			const fields: readonly string[] = runFields;
			if (field === undefined || !fields.includes(field)) {
				error(
					`${uses}, but the run has no field ${field === undefined ? "there" : `"${field}"`}. Use one of: ${fields.join(", ")}.`,
					at,
				);
			} else if (deeper.length > 0) {
				error(`${uses}, but run.${field} is text: it takes no path.`, at);
			}
			continue;
		}

		const input = inputs.get(ref.name);
		if (input !== undefined) {
			if (input.type === "text" && field !== undefined) {
				error(
					`${uses}, but the input "${ref.name}" is text: it takes no path. Write {{${ref.name}}}, or make it a json input.`,
					at,
				);
			}
			continue;
		}

		const node = scope.nodes.get(ref.name);
		if (node === undefined) {
			error(`${uses}, but there is no node or input "${ref.name}".`, at);
			continue;
		}

		let fields: readonly string[] = outputFieldsByType[node.type];
		/** Fields that take a deeper path. */
		let json: readonly string[] = jsonOutputFields;
		if (node.type === "subflow") {
			const called = calledFlow(node, scope.flows);
			// Unknown until the flows load, or broken: the call reports that.
			if (called === undefined) continue;
			fields = nodeOutputFields(node, called);
			json = [...json, ...called.outputs.map((output) => output.name)];
		}
		if (field === undefined) {
			error(
				`${uses}, but a node needs a field: {{${ref.name}.<field>}}. Use one of: ${fields.join(", ")}.`,
				at,
			);
		} else if (!fields.includes(field)) {
			error(
				`${uses}, but "${ref.name}" has no field "${field}". Use one of: ${fields.join(", ")}.`,
				at,
			);
		} else if (deeper.length > 0 && !json.includes(field)) {
			error(`${uses}, but ${ref.name}.${field} is text: it takes no path.`, at);
		}
	}
}

/** The flow a Subflow node calls; undefined when it is not known or broken. */
function calledFlow(
	node: SubflowNode,
	flows: Flows | undefined,
): Flow | undefined {
	if (flows === undefined || !Object.hasOwn(flows, node.flow)) return undefined;
	return flows[node.flow] ?? undefined;
}

/** A JSON Schema for an object: `type: "object"`, or `properties`. */
function isObjectSchema(schema: Record<string, unknown>): boolean {
	return (
		schema.type === "object" ||
		(typeof schema.properties === "object" && schema.properties !== null)
	);
}

/**
 * The called flow must exist and parse, take every binding, and get every
 * required input without a default. It may not lead back to the flow being
 * checked (the last of `chain`). Cycles through an outer flow are left to
 * that flow, so each is reported once.
 */
function checkCall(
	node: SubflowNode | ForEachNode,
	flows: Flows,
	chain: readonly string[],
	error: Report,
	warning: Report,
): void {
	const at = { nodeId: node.id };
	const kind = node.type === "subflow" ? "Subflow" : "For Each";
	const runs = `${kind} node "${node.id}" runs flow "${node.flow}"`;
	if (!Object.hasOwn(flows, node.flow)) {
		error(`${runs}, which does not exist.`, at);
		return;
	}
	const called = flows[node.flow];
	if (!called) {
		error(`${runs}, which does not parse. Fix that file first.`, at);
		return;
	}

	const inputs = new Map(called.inputs.map((input) => [input.name, input]));
	const bound = new Set(Object.keys(node.inputs));
	if (node.type === "foreach") {
		const as = inputs.get(node.as);
		if (as === undefined) {
			error(
				`${runs}, which has no input "${node.as}" to take each element. Add a json input "${node.as}" to it, or change "as".`,
				at,
			);
		} else if (as.type === "text") {
			warning(
				`${runs}, whose input "${node.as}" is text: an element that is an object or an array arrives as JSON text. Make it a json input.`,
				at,
			);
		}
		if (bound.has(node.as)) {
			error(
				`For Each node "${node.id}" binds the input "${node.as}", which already takes each element.`,
				at,
			);
		}
		bound.add(node.as);
	}
	for (const name of Object.keys(node.inputs)) {
		if (!inputs.has(name)) {
			error(
				`${kind} node "${node.id}" binds the input "${name}", but flow "${node.flow}" has no such input.`,
				at,
			);
		}
	}
	for (const input of called.inputs) {
		if (
			input.required &&
			input.default === undefined &&
			!bound.has(input.name)
		) {
			error(
				`${kind} node "${node.id}" does not bind the required input "${input.name}" of flow "${node.flow}".`,
				at,
			);
		}
	}

	const self = chain.at(-1);
	if (self !== undefined) {
		const path = pathBack(node.flow, self, flows, new Set(chain.slice(0, -1)));
		if (path !== null) {
			error(
				`${runs}, which runs this flow again: ${[self, ...path].join(" → ")}. A flow cannot contain itself.`,
				at,
			);
		}
	}
	if (chain.includes(node.flow)) return;

	const count = validateIn(called, { flows, name: node.flow }, chain).filter(
		(issue) => issue.severity === "error",
	).length;
	if (count > 0) {
		error(
			`Flow "${node.flow}" of ${kind} node "${node.id}" has ${count} ${count === 1 ? "error" : "errors"}.`,
			at,
		);
	}
}

/**
 * The shortest chain of calls (Subflow and For Each nodes) from `start` to
 * `target`, both included, or null. Does not pass through `skip`.
 */
function pathBack(
	start: string,
	target: string,
	flows: Flows,
	skip: ReadonlySet<string>,
): string[] | null {
	if (start === target) return [start];
	if (skip.has(start)) return null;
	const parent = new Map<string, string>([[start, start]]);
	const queue = [start];
	for (let name = queue.shift(); name !== undefined; name = queue.shift()) {
		const flow = Object.hasOwn(flows, name) ? flows[name] : null;
		for (const node of flow?.nodes ?? []) {
			if (node.type !== "foreach" && node.type !== "subflow") continue;
			if (parent.has(node.flow)) continue;
			parent.set(node.flow, name);
			if (node.flow === target) {
				const path = [target];
				for (let at = name; at !== start; ) {
					path.push(at);
					at = parent.get(at) ?? start;
				}
				path.push(start);
				return path.reverse();
			}
			if (!skip.has(node.flow)) queue.push(node.flow);
		}
	}
	return null;
}

/** Halt labels are outcomes of the called flow: valid labels, not reserved. */
function checkHaltOn(node: ForEachNode, error: Report): void {
	const reserved: readonly string[] = reservedOutcomes;
	for (const label of node.haltOn) {
		const parsed = labelSchema.safeParse(label);
		if (!parsed.success) {
			error(
				`For Each node "${node.id}" halts on "${label}", which is not a valid label: ${parsed.error.issues[0]?.message ?? "not allowed"}`,
				{ nodeId: node.id },
			);
		} else if (reserved.includes(label)) {
			error(
				`For Each node "${node.id}" halts on "${label}", which is reserved. Do not use: ${reserved.join(", ")}.`,
				{ nodeId: node.id },
			);
		}
	}
}

function describeNode(node: FlowNode): string {
	return node.type === "command" ||
		(node.type === "agent" && node.outcomes === undefined)
		? `a ${node.type} node`
		: `"${node.id}"`;
}

const optionWords = {
	agent: { title: "Agent", kind: "outcome", picker: "the agent reports" },
	decision: { title: "Decision", kind: "label", picker: "the decider picks" },
	gate: { title: "Gate", kind: "choice", picker: "the person picks" },
} as const;

/**
 * Agent outcomes, Decision labels and Gate choices are outcomes: each must be
 * a valid label, unique within its node and not reserved for the engine. One
 * without an edge is allowed, but ending on it ends the run there: a warning,
 * except an Agent's own `fail` or `needs-input`, which fail the step anyway.
 */
function checkOptions(
	node: Extract<FlowNode, { type: "agent" | "decision" | "gate" }>,
	flow: Flow,
	error: Report,
	warning: Report,
): void {
	const { title, kind, picker } = optionWords[node.type];
	const at = { nodeId: node.id };
	const reserved: readonly string[] = reservedOutcomes;
	const seen = new Set<string>();
	for (const name of nodeOutcomes(node)) {
		if (seen.has(name)) {
			error(
				`${title} node "${node.id}" has the ${kind} "${name}" more than once.`,
				at,
			);
			continue;
		}
		seen.add(name);
		const valid = labelSchema.safeParse(name);
		if (!valid.success) {
			error(
				`${title} node "${node.id}" has the ${kind} "${name}", which is not a valid label: ${valid.error.issues[0]?.message ?? "not allowed"}`,
				at,
			);
			continue;
		}
		if (reserved.includes(name)) {
			error(
				`${title} node "${node.id}" uses the ${kind} "${name}", which is reserved. Do not use: ${reserved.join(", ")}.`,
				at,
			);
			continue;
		}
		const routed = flow.edges.some(
			(edge) => edge.from === node.id && edge.outcome === name,
		);
		// An agent that reports fail or needs-input fails anyway: no surprise.
		const failing =
			node.type === "agent" && (name === "fail" || name === "needs-input");
		if (!routed && !failing) {
			warning(
				`${title} node "${node.id}" has no edge for "${name}": the run ends there when ${picker} "${name}".`,
				at,
			);
		}
	}
}

/**
 * One cycle per strongly connected component that loops (Tarjan), as the
 * node ids along a simple cycle in that component.
 */
function findCycles(
	ids: readonly string[],
	edges: readonly { from: string; to: string }[],
): string[][] {
	const next = new Map<string, string[]>(ids.map((id) => [id, []]));
	for (const edge of edges) next.get(edge.from)?.push(edge.to);

	let counter = 0;
	const index = new Map<string, number>();
	const low = new Map<string, number>();
	const onStack = new Set<string>();
	const stack: string[] = [];
	const components: string[][] = [];

	const connect = (id: string) => {
		index.set(id, counter);
		low.set(id, counter);
		counter++;
		stack.push(id);
		onStack.add(id);
		for (const to of next.get(id) ?? []) {
			if (!index.has(to)) {
				connect(to);
				low.set(id, Math.min(low.get(id) ?? 0, low.get(to) ?? 0));
			} else if (onStack.has(to)) {
				low.set(id, Math.min(low.get(id) ?? 0, index.get(to) ?? 0));
			}
		}
		if (low.get(id) === index.get(id)) {
			const component: string[] = [];
			let member: string | undefined;
			do {
				member = stack.pop();
				if (member === undefined) break;
				onStack.delete(member);
				component.push(member);
			} while (member !== id);
			components.push(component);
		}
	};
	for (const id of ids) if (!index.has(id)) connect(id);

	const cycles: string[][] = [];
	for (const component of components) {
		const members = new Set(component);
		// Start at the member that comes first in the file.
		const start = ids.find((id) => members.has(id));
		if (start === undefined) continue;
		if (component.length === 1 && !next.get(start)?.includes(start)) continue;
		cycles.push(cycleThrough(start, members, next));
	}
	return cycles.sort(
		(a, b) => ids.indexOf(a[0] ?? "") - ids.indexOf(b[0] ?? ""),
	);
}

/** A shortest path from `start` back to itself, inside one component. */
function cycleThrough(
	start: string,
	members: ReadonlySet<string>,
	next: ReadonlyMap<string, string[]>,
): string[] {
	const parent = new Map<string, string>();
	const queue = [start];
	for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
		for (const to of next.get(id) ?? []) {
			if (to === start) {
				const path = [id];
				for (let at = id; at !== start; ) {
					const up = parent.get(at);
					if (up === undefined) break;
					path.push(up);
					at = up;
				}
				return path.reverse();
			}
			if (members.has(to) && !parent.has(to)) {
				parent.set(to, id);
				queue.push(to);
			}
		}
	}
	return [start];
}

/**
 * Migrates (`migrateFlow`), parses and validates unknown JSON. Schema errors
 * come back as issues.
 */
export function parseFlow(
	json: unknown,
	options: ValidateOptions = {},
): { flow: Flow; issues: FlowIssue[] } | { flow: null; issues: FlowIssue[] } {
	const result = flowSchema.safeParse(migrateFlow(json));
	if (!result.success) {
		return {
			flow: null,
			issues: result.error.issues.map((issue) => ({
				severity: "error",
				message: `${issue.path.length > 0 ? issue.path.map(String).join(".") : "(root)"}: ${issue.message}`,
			})),
		};
	}
	return { flow: result.data, issues: validateFlow(result.data, options) };
}
