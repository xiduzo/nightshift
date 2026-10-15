import {
	type Flow,
	type FlowNode,
	flowSchema,
	nodeOutcomes,
	outputFieldsByType,
	reservedOutcomes,
	runFields,
} from "./schema";
import { templateRefs } from "./template";
import type { FlowIssue } from "./types";

/**
 * Checks what the schema cannot: unique ids, a known start node, edges between
 * known nodes with outcomes the source node can produce, an Agent node with a
 * prompt or a skill, Decision labels and Gate choices that are unique and not
 * reserved, template references to known nodes and fields, and no cycle
 * without an edge that has a `max` (a Gate in a cycle too: a person could
 * loop forever). Warns about unreachable nodes and about Decision labels or
 * Gate choices without an edge, since picking one ends the run as failed.
 */
export function validateFlow(flow: Flow): FlowIssue[] {
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
		if (node.id === "run") {
			error(`Node id "run" is reserved for {{run.<field>}} templates.`, {
				nodeId: node.id,
			});
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
				checkTemplate(node, node.prompt, "prompt", nodes, error);
				break;
			case "command":
				checkTemplate(node, node.command, "command", nodes, error);
				break;
			case "decision":
				checkOptions(node, "label", "the decider", flow, error, warning);
				checkTemplate(node, node.prompt, "prompt", nodes, error);
				break;
			case "gate":
				checkOptions(node, "choice", "the person", flow, error, warning);
				checkTemplate(node, node.question, "question", nodes, error);
				break;
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
	error: (message: string, at: Pick<FlowIssue, "nodeId">) => void,
): void {
	for (const ref of templateRefs(text)) {
		let fields: readonly string[];
		if (ref.scope === "run") {
			fields = runFields;
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
	return { flow: result.data, issues: validateFlow(result.data) };
}
