import {
	type Flow,
	type FlowMigration,
	type FlowNode,
	fanOutsOf,
	flowSchema,
	migrateFlow,
	nodeOutcomes,
} from "../flow";
import { isKitName } from "../kits";
import { reservedNames } from "../nodes";
import { checkBranches } from "./branches";
import { checkCall, type ErrorsOf } from "./calls";
import { findCycles } from "./cycles";
import type {
	FlowIssue,
	ProjectFlowMap,
	Report,
	ValidateOptions,
} from "./issues";
import { checkNode } from "./nodes";
import { describeNode, type Scope } from "./scope";
import { checkSections } from "./sections";
import { templateScope } from "./template-scope";
import {
	checkInputs,
	checkOutputs,
	checkUnusedVariables,
	checkVariables,
	checkWrites,
} from "./values";

/**
 * Checks what the schema cannot: unique names (node ids and inputs share one
 * namespace, `run` is reserved), a known start node, edges between known
 * nodes with outcomes the source node can produce, an Agent node with a
 * prompt or a skill, outcomes and options that are unique and not reserved,
 * a Decision's rules (`when`) that parse and read known names, an Agent
 * output schema that describes an object, a Value node with an expression
 * (a rule) or a prompt and a decider that can make a value (a model) and an
 * output schema that describes an object, template references to known
 * names and fields, outputs, and no cycle without an edge that has a `max`
 * (a Gate in a cycle too: a person could loop forever).
 * Parallel branches (a fan-out: several edges without a max on one
 * outcome) each reach the same Join (`checkBranches`).
 * Warns about unreachable nodes and about outcomes without an edge, since
 * ending on one ends the run as failed. Warns about Sections that are not
 * one connected part with one entry, share a node, or name unknown nodes.
 *
 * With `options.flows`, a Call node must call a flow that exists and
 * parses, bind only inputs it declares and every required input it has no
 * default for, and a flow may not call itself through Call nodes. Issues
 * inside a called flow are not repeated: a called flow with errors gives
 * one error on the calling node. A Call node that runs a kit gets the same
 * checks of its inputs, with or without `options.flows`: Night Shift
 * always knows its kits.
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

	const flows: ProjectFlowMap | undefined =
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
		if (
			"device" in node &&
			node.device !== undefined &&
			(node.type === "decision" || node.type === "value") &&
			node.by !== "model"
		) {
			error(
				`Node "${node.id}" names the device "${node.device}", but ${node.type === "decision" ? (node.by === "person" ? "you decide it" : "a rule decides it") : "a rule makes it"}. Only a model runs on a device. Remove the device.`,
				{ nodeId: node.id },
			);
		}
		if (reserved.includes(node.id)) {
			error(`The node id "${node.id}" is reserved. Give the node another id.`, {
				nodeId: node.id,
			});
		}
	}

	const scope: Scope = {
		flow,
		nodes,
		flows,
		template: templateScope(flow, { flows }),
		readVars: new Set(),
	};
	checkInputs(flow, nodes, error);
	checkVariables(scope, error);

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
		} else if (
			source.type === "agent" &&
			source.ask === "person" &&
			edge.outcome === "needs-input"
		) {
			error(
				`Edge "${edge.id}" leaves "${edge.from}" on "needs-input", but that agent asks a person when it needs input and takes no edge. Remove the edge, or let the agent end on needs-input.`,
				{ edgeId: edge.id },
			);
		} else if (source.type === "end") {
			error(
				`Edge "${edge.id}" leaves the End node "${edge.from}". An End node ends the run, so no edge can leave it.`,
				{ edgeId: edge.id },
			);
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
	// outcome has no max, so the engine always picks that one. Two or more
	// without a max are a fan-out instead (`checkBranches`).
	const unbounded = new Map<string, string>();
	const fannedOut = new Set(
		fanOutsOf(flow).map((fanOut) => `${fanOut.from}\u0000${fanOut.outcome}`),
	);
	for (const edge of flow.edges) {
		const key = `${edge.from}\u0000${edge.outcome}`;
		if (fannedOut.has(key)) continue;
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
		checkNode(node, scope, error, warning);
		checkWrites(node, scope, error);
	}

	checkOutputs(scope, error);
	checkUnusedVariables(scope, warning);
	checkBranches(flow, nodes, error, warning);

	// Called flows: a kit always, a flow of the project when they are known.
	const chain =
		options.name === undefined ? ancestors : [...ancestors, options.name];
	for (const node of nodes.values()) {
		if (node.type !== "call") continue;
		if (flows !== undefined) {
			checkCall(node, flows, chain, error, warning, errorsOf);
		} else if (isKitName(node.flow)) {
			checkCall(node, {}, chain, error, warning, errorsOf);
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

	checkSections(flow, warning);

	return issues;
}

/** The errors of a called flow, for the one error on the node that calls it. */
const errorsOf: ErrorsOf = (flow, options, chain) =>
	validateIn(flow, options, chain).filter((issue) => issue.severity === "error")
		.length;

/**
 * Migrates (`migrateFlow`, with `migration` for a flow of format 6 when
 * given), parses and validates unknown JSON. Schema errors come back as
 * issues.
 */
export function parseFlow(
	json: unknown,
	options: ValidateOptions & { migration?: FlowMigration } = {},
): { flow: Flow; issues: FlowIssue[] } | { flow: null; issues: FlowIssue[] } {
	const { migration, ...validate } = options;
	const result = flowSchema.safeParse(migrateFlow(json, migration));
	if (!result.success) {
		return {
			flow: null,
			issues: result.error.issues.map((issue) => ({
				severity: "error",
				message: `${issue.path.length > 0 ? issue.path.map(String).join(".") : "(root)"}: ${issue.message}`,
			})),
		};
	}
	return { flow: result.data, issues: validateFlow(result.data, validate) };
}
