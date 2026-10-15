import {
	type Flow,
	type FlowNode,
	type ForEachNode,
	flowSchema,
	itemFields,
	labelSchema,
	nodeOutcomes,
	outputFieldsByType,
	reservedOutcomes,
	runFields,
} from "./schema";
import { templateRefs } from "./template";
import type { FlowIssue, ValidateOptions } from "./types";

/**
 * Checks what the schema cannot: unique ids, a known start node, edges between
 * known nodes with outcomes the source node can produce, an Agent node with a
 * prompt or a skill, Decision labels and Gate choices that are unique and not
 * reserved, template references to known nodes and fields, and no cycle
 * without an edge that has a `max` (a Gate in a cycle too: a person could
 * loop forever). Warns about unreachable nodes and about Decision labels or
 * Gate choices without an edge, since picking one ends the run as failed.
 *
 * `{{item.<field>}}` works only in a flow with `input: "item"`. With
 * `options.flows`, a For Each body must exist, parse and have
 * `input: "item"`, and a flow may not run itself through For Each bodies.
 * Issues inside a body are not repeated: a body with errors gives one error
 * on the For Each node.
 */
export function validateFlow(
	flow: Flow,
	options: ValidateOptions = {},
): FlowIssue[] {
	return validateIn(flow, options, []);
}

/** `ancestors`: the flows whose For Each bodies led here, outermost first. */
function validateIn(
	flow: Flow,
	options: ValidateOptions,
	ancestors: readonly string[],
): FlowIssue[] {
	const issues: FlowIssue[] = [];
	const error = (message: string, at: Pick<FlowIssue, "nodeId" | "edgeId">) =>
		issues.push({ severity: "error", message, ...at });
	const warning = (message: string, at: Pick<FlowIssue, "nodeId" | "edgeId">) =>
		issues.push({ severity: "warning", message, ...at });

	// Nodes: first occurrence of each id wins.
	const nodes = new Map<string, FlowNode>();
	for (const node of flow.nodes) {
		if (nodes.has(node.id)) {
			error(`Node id "${node.id}" is used more than once.`, {
				nodeId: node.id,
			});
			continue;
		}
		nodes.set(node.id, node);
		if (node.id === "run" || node.id === "item") {
			error(
				`Node id "${node.id}" is reserved for {{${node.id}.<field>}} templates.`,
				{ nodeId: node.id },
			);
		}
	}

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
	for (const node of nodes.values()) {
		switch (node.type) {
			case "agent":
				if (node.prompt.trim() === "" && node.skill === undefined) {
					error(`Agent node "${node.id}" needs a prompt or a skill.`, {
						nodeId: node.id,
					});
				}
				checkTemplate(node, node.prompt, "prompt", nodes, flow.input, error);
				break;
			case "command":
				checkTemplate(node, node.command, "command", nodes, flow.input, error);
				break;
			case "decision":
				checkOptions(node, "label", "the decider", flow, error, warning);
				checkTemplate(node, node.prompt, "prompt", nodes, flow.input, error);
				break;
			case "gate":
				checkOptions(node, "choice", "the person", flow, error, warning);
				checkTemplate(
					node,
					node.question,
					"question",
					nodes,
					flow.input,
					error,
				);
				break;
			case "foreach":
				if (node.source.kind === "github") {
					checkTemplate(
						node,
						node.source.parent,
						"source parent",
						nodes,
						flow.input,
						error,
					);
				} else {
					checkTemplate(
						node,
						node.source.command,
						"source command",
						nodes,
						flow.input,
						error,
					);
				}
				checkHaltOn(node, error);
				break;
		}
	}

	// For Each bodies, when the project's flows are known.
	if (options.flows !== undefined) {
		const flows: Record<string, Flow | null> = { ...options.flows };
		if (options.name !== undefined) flows[options.name] = flow;
		const chain =
			options.name === undefined ? ancestors : [...ancestors, options.name];
		for (const node of nodes.values()) {
			if (node.type === "foreach") checkBody(node, flows, chain, error);
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

/**
 * The body must exist, parse and take an item. It may not lead back to the
 * flow being checked (the last of `chain`). Cycles through an outer flow are
 * left to that flow, so each is reported once.
 */
function checkBody(
	node: ForEachNode,
	flows: Readonly<Record<string, Flow | null>>,
	chain: readonly string[],
	error: (message: string, at: Pick<FlowIssue, "nodeId">) => void,
): void {
	const at = { nodeId: node.id };
	const runs = `For Each node "${node.id}" runs flow "${node.flow}"`;
	if (!Object.hasOwn(flows, node.flow)) {
		error(`${runs}, which does not exist.`, at);
		return;
	}
	const body = flows[node.flow];
	if (!body) {
		error(`${runs}, which does not parse. Fix that file first.`, at);
		return;
	}
	if (body.input !== "item") {
		error(
			`${runs}, which is not a For Each body. Set its input to "item".`,
			at,
		);
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

	const count = validateIn(body, { flows, name: node.flow }, chain).filter(
		(issue) => issue.severity === "error",
	).length;
	if (count > 0) {
		error(
			`Body flow "${node.flow}" of For Each node "${node.id}" has ${count} ${count === 1 ? "error" : "errors"}.`,
			at,
		);
	}
}

/**
 * The shortest chain of For Each bodies from `start` to `target`, both
 * included, or null. Does not pass through `skip`.
 */
function pathBack(
	start: string,
	target: string,
	flows: Readonly<Record<string, Flow | null>>,
	skip: ReadonlySet<string>,
): string[] | null {
	if (start === target) return [start];
	if (skip.has(start)) return null;
	const parent = new Map<string, string>([[start, start]]);
	const queue = [start];
	for (let name = queue.shift(); name !== undefined; name = queue.shift()) {
		const flow = Object.hasOwn(flows, name) ? flows[name] : null;
		for (const node of flow?.nodes ?? []) {
			if (node.type !== "foreach" || parent.has(node.flow)) continue;
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

/** Halt labels are outcomes of the body: valid labels, not reserved. */
function checkHaltOn(
	node: ForEachNode,
	error: (message: string, at: Pick<FlowIssue, "nodeId">) => void,
): void {
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
	return node.type === "agent" || node.type === "command"
		? `a ${node.type} node`
		: `"${node.id}"`;
}

/**
 * Decision labels and Gate choices are outcomes: each must be unique within
 * its node and not reserved for the engine. One without an edge is allowed,
 * but picking it ends the run as failed.
 */
function checkOptions(
	node: Extract<FlowNode, { type: "decision" | "gate" }>,
	kind: "label" | "choice",
	picker: string,
	flow: Flow,
	error: (message: string, at: Pick<FlowIssue, "nodeId">) => void,
	warning: (message: string, at: Pick<FlowIssue, "nodeId">) => void,
): void {
	const title = node.type === "decision" ? "Decision" : "Gate";
	const names = nodeOutcomes(node);
	const reserved: readonly string[] = reservedOutcomes;
	const seen = new Set<string>();
	for (const name of names) {
		if (seen.has(name)) {
			error(
				`${title} node "${node.id}" has the ${kind} "${name}" more than once.`,
				{ nodeId: node.id },
			);
			continue;
		}
		seen.add(name);
		if (reserved.includes(name)) {
			error(
				`${title} node "${node.id}" uses the ${kind} "${name}", which is reserved. Do not use: ${reserved.join(", ")}.`,
				{ nodeId: node.id },
			);
			continue;
		}
		const routed = flow.edges.some(
			(edge) => edge.from === node.id && edge.outcome === name,
		);
		if (!routed) {
			warning(
				`${title} node "${node.id}" has no edge for "${name}": the run ends there when ${picker} picks "${name}".`,
				{ nodeId: node.id },
			);
		}
	}
}

function checkTemplate(
	node: FlowNode,
	text: string,
	where: string,
	nodes: ReadonlyMap<string, FlowNode>,
	input: Flow["input"],
	error: (message: string, at: Pick<FlowIssue, "nodeId">) => void,
): void {
	for (const ref of templateRefs(text)) {
		let fields: readonly string[];
		if (ref.scope === "run") {
			fields = runFields;
		} else if (ref.scope === "item") {
			if (input !== "item") {
				error(
					`The ${where} of "${node.id}" uses ${ref.raw}, but only a For Each body can read item fields. Set the flow's input to "item".`,
					{ nodeId: node.id },
				);
				continue;
			}
			fields = itemFields;
		} else {
			const target = nodes.get(ref.scope);
			if (!target) {
				error(
					`The ${where} of "${node.id}" uses ${ref.raw}, but there is no node "${ref.scope}".`,
					{ nodeId: node.id },
				);
				continue;
			}
			fields = outputFieldsByType[target.type];
		}
		if (!fields.includes(ref.field)) {
			error(
				`The ${where} of "${node.id}" uses ${ref.raw}, but "${ref.scope}" has no field "${ref.field}". Use one of: ${fields.join(", ")}.`,
				{ nodeId: node.id },
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

/** Parses unknown JSON and validates it. Schema errors come back as issues. */
export function parseFlow(
	json: unknown,
	options: ValidateOptions = {},
): { flow: Flow; issues: FlowIssue[] } | { flow: null; issues: FlowIssue[] } {
	const result = flowSchema.safeParse(json);
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
