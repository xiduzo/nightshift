import { migrateFlow } from "./migrate";
import { ruleNames, ruleProblem } from "./rule";
import {
	type CallEachNode,
	type CallNode,
	type CommandNode,
	canMakeValue,
	commandExits,
	type DecisionNode,
	type Flow,
	type FlowNode,
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
	runsEach,
	type ValueNode,
	valueDeciderNameSchema,
	type WaitNode,
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
 * prompt or a skill, outcomes and options that are unique and not reserved,
 * a Decision's rules (`when`) that parse and read known names, an Agent
 * output schema that describes an object, a Value node with an expression
 * (a rule) or a prompt and a decider that can make a value (a model) and an
 * output schema that describes an object, template references to known
 * names and fields, outputs, and no cycle without an edge that has a `max`
 * (a Gate in a cycle too: a person could loop forever).
 * Warns about unreachable nodes and about outcomes without an edge, since
 * ending on one ends the run as failed.
 *
 * With `options.flows`, a Call node must call a flow that exists and
 * parses, bind only inputs it declares and every required input it has no
 * default for, and a flow may not call itself through Call nodes. Issues
 * inside a called flow are not repeated: a called flow with errors gives
 * one error on the calling node.
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
				if (node.checker?.prompt)
					template(node.checker.prompt, "checker prompt");
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
				if (node.exits !== undefined) {
					checkOptions(node, flow, error, warning);
					checkExits(node, error, warning);
				}
				break;
			case "decision":
				checkOptions(node, flow, error, warning);
				checkDecision(node, scope, error, warning);
				template(node.prompt, "prompt");
				break;
			case "call":
				if (runsEach(node)) {
					switch (node.each.source.kind) {
						case "json":
							template(node.each.source.value, "source value");
							break;
						case "command":
							template(node.each.source.command, "source command");
							break;
						case "files":
							template(node.each.source.glob, "source glob");
							break;
					}
					checkHaltOn(node, error);
				}
				for (const [name, value] of Object.entries(node.inputs)) {
					template(value, `input "${name}"`);
				}
				break;
			case "value":
				checkValue(node, scope, error);
				if (node.prompt !== undefined) template(node.prompt, "prompt");
				break;
			case "wait":
				checkWait(node, template, error);
				break;
			case "tool":
				if (node.tool.trim() === "") {
					error(`Tool node "${node.id}" needs the name of a tool.`, at);
				}
				for (const [name, value] of Object.entries(node.arguments)) {
					template(value, `argument "${name}"`);
				}
				break;
		}
	}

	checkOutputs(scope, error);

	// Called flows, when the project's flows are known.
	if (flows !== undefined) {
		const chain =
			options.name === undefined ? ancestors : [...ancestors, options.name];
		for (const node of nodes.values()) {
			if (node.type === "call") {
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
			error(`The input name "${name}" is reserved. Pick another name.`, {});
		}
		if (nodes.has(name)) {
			error(
				`The input "${name}" has the same name as the node "${name}". Rename one of them.`,
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
	const builtIn: readonly string[] = outputFieldsByType.call;
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
 * below a Call node's flow outputs, which hold JSON). A Command node's
 * `data` needs `output: "json"`.
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

		let fields: readonly string[] = nodeOutputFields(node);
		/** Fields that take a deeper path. */
		let json: readonly string[] = jsonOutputFields;
		if (node.type === "call" && !runsEach(node)) {
			const called = calledFlow(node, scope.flows);
			// Unknown until the flows load, or broken: the call reports that.
			if (called === undefined) continue;
			fields = nodeOutputFields(node, called);
			json = [...json, ...called.outputs.map((output) => output.name)];
		}
		if (node.type === "command" && field === "data" && node.output !== "json") {
			error(
				`${uses}, but the command node "${ref.name}" prints text. Set its output to JSON to read data.`,
				at,
			);
			continue;
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

/** The flow a Call node calls; undefined when it is not known or broken. */
function calledFlow(
	node: CallNode,
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
	node: CallNode,
	flows: Flows,
	chain: readonly string[],
	error: Report,
	warning: Report,
): void {
	const at = { nodeId: node.id };
	const kind = "Subflow";
	const runs = `${kind} node "${node.id}" runs flow "${node.flow}"`;
	if (!Object.hasOwn(flows, node.flow)) {
		error(`${runs}, which does not exist.`, at);
		return;
	}
	const called = flows[node.flow];
	if (!called) {
		error(`${runs}, which is not valid. Open that flow and fix it first.`, at);
		return;
	}

	const inputs = new Map(called.inputs.map((input) => [input.name, input]));
	const bound = new Set(Object.keys(node.inputs));
	if (runsEach(node)) {
		const { as: name } = node.each;
		const as = inputs.get(name);
		if (as === undefined) {
			error(
				`${runs}, which has no input "${name}" to take each item. Add a json input "${name}" to it, or change "as".`,
				at,
			);
		} else if (as.type === "text") {
			warning(
				`${runs}, whose input "${name}" is text: an item that is an object or an array arrives as JSON text. Make it a json input.`,
				at,
			);
		}
		if (bound.has(name)) {
			error(
				`${kind} node "${node.id}" binds the input "${name}", which already takes each item.`,
				at,
			);
		}
		bound.add(name);
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
 * The shortest chain of calls (Call nodes) from `start` to `target`, both
 * included, or null. Does not pass through `skip`.
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
			if (node.type !== "call") continue;
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
function checkHaltOn(node: CallEachNode, error: Report): void {
	const reserved: readonly string[] = reservedOutcomes;
	for (const label of node.each.haltOn) {
		const parsed = labelSchema.safeParse(label);
		if (!parsed.success) {
			error(
				`Subflow node "${node.id}" halts on "${label}", which is not a valid label: ${parsed.error.issues[0]?.message ?? "not allowed"}`,
				{ nodeId: node.id },
			);
		} else if (reserved.includes(label)) {
			error(
				`Subflow node "${node.id}" halts on "${label}", which is reserved. Do not use: ${reserved.join(", ")}.`,
				{ nodeId: node.id },
			);
		}
	}
}

/**
 * A Wait node's templates (the time, the command) read known names, and a
 * command that runs every `everyMinutes` needs a timeout longer than that:
 * a shorter one times out before the second try.
 */
function checkWait(
	node: WaitNode,
	template: (text: string, where: string) => void,
	error: Report,
): void {
	const until = node.until;
	if (until.kind === "time") template(until.at, "time");
	if (until.kind === "command") {
		template(until.command, "command");
		if (
			node.timeoutMinutes !== undefined &&
			node.timeoutMinutes <= until.everyMinutes
		) {
			error(
				`Wait node "${node.id}" runs its command every ${until.everyMinutes} min but times out after ${node.timeoutMinutes} min. Give it a longer timeout than the interval.`,
				{ nodeId: node.id },
			);
		}
	}
}

function describeNode(node: FlowNode): string {
	return node.type === "agent" && node.outcomes === undefined
		? `a ${node.type} node`
		: `"${node.id}"`;
}

const optionWords = {
	agent: { title: "Agent", kind: "outcome", picker: "the agent reports" },
	command: { title: "Command", kind: "exit", picker: "the command ends on" },
	decision: { title: "Decision", kind: "option", picker: "" },
} as const;

/** Who picks a Decision's option, for the warning on an option without an edge. */
const pickerWords: Record<DecisionNode["by"], string> = {
	person: "you pick",
	rule: "the rule picks",
	model: "the model picks",
};

/**
 * A Decision decided by a person or a model needs a prompt. Rules (`when`)
 * belong to a Decision decided by a rule, where every option but the last
 * has one: the first rule that holds picks its option, and the option
 * without a rule is the default. A rule must parse, and the names it reads
 * must be inputs or nodes of the flow.
 */
function checkDecision(
	node: DecisionNode,
	scope: Scope,
	error: Report,
	warning: Report,
): void {
	const at = { nodeId: node.id };
	const ruled = node.options.filter(
		(option) => option.when !== undefined && option.when.trim() !== "",
	);
	if (node.by !== "rule") {
		if (node.prompt.trim() === "") {
			error(
				node.by === "person"
					? `Decision node "${node.id}" needs a question for you to answer.`
					: `Decision node "${node.id}" needs a prompt for the model.`,
				at,
			);
		}
		if (ruled.length > 0) {
			error(
				`Decision node "${node.id}" has a rule on "${ruled[0]?.name}", but ${node.by === "person" ? "you decide" : "a model decides"} it. Remove the rule, or let a rule decide.`,
				at,
			);
		}
		return;
	}
	const defaults = node.options.filter((option) => !ruled.includes(option));
	if (defaults.length > 1) {
		error(
			`Decision node "${node.id}" has ${defaults.length} options without a rule (${defaults.map((o) => `"${o.name}"`).join(", ")}). Give all but one a rule: the one without is the default.`,
			at,
		);
	} else if (defaults.length === 1 && node.options.at(-1) !== defaults[0]) {
		warning(
			`Decision node "${node.id}": the option "${defaults[0]?.name}" has no rule, so it always matches. Put it last, or the options after it are never picked.`,
			at,
		);
	}
	const known = new Set<string>([
		"run",
		...scope.flow.inputs.map((input) => input.name),
		...scope.nodes.keys(),
	]);
	for (const option of ruled) {
		const when = option.when ?? "";
		const problem = ruleProblem(when);
		const rule = `The rule of option "${option.name}" of "${node.id}"`;
		if (problem !== null) {
			error(`${rule} is not valid: ${problem}`, at);
			continue;
		}
		for (const name of ruleNames(when)) {
			if (!known.has(name)) {
				error(
					`${rule} reads "${name}", but there is no node or input "${name}".`,
					at,
				);
			}
		}
	}
}

/**
 * A Value node's output schema must describe an object. Made by a rule, it
 * needs an expression that parses and reads only inputs or nodes of the
 * flow. Made by a model, it needs a prompt and a decider that can make a
 * value (one with a text adapter: TypeSafe and Ollaya only decide).
 */
function checkValue(node: ValueNode, scope: Scope, error: Report): void {
	const at = { nodeId: node.id };
	if (!isObjectSchema(node.output)) {
		error(
			`The output schema of value node "${node.id}" must describe an object: give it "type": "object" or "properties".`,
			at,
		);
	}
	if (node.by === "model") {
		if (node.prompt === undefined || node.prompt.trim() === "") {
			error(`Value node "${node.id}" needs a prompt for the model.`, at);
		}
		if (!canMakeValue(node.decider)) {
			error(
				`Value node "${node.id}" uses the decider "${node.decider}", which cannot make a value. Choose one of: ${valueDeciderNameSchema.options.join(", ")}.`,
				at,
			);
		}
		return;
	}
	const expression = node.expression ?? "";
	if (expression.trim() === "") {
		error(`Value node "${node.id}" needs an expression.`, at);
		return;
	}
	const problem = ruleProblem(expression);
	if (problem !== null) {
		error(`The expression of "${node.id}" is not valid: ${problem}`, at);
		return;
	}
	const known = new Set<string>([
		"run",
		...scope.flow.inputs.map((input) => input.name),
		...scope.nodes.keys(),
	]);
	for (const name of ruleNames(expression)) {
		if (!known.has(name)) {
			error(
				`The expression of "${node.id}" reads "${name}", but there is no node or input "${name}".`,
				at,
			);
		}
	}
}

/**
 * Agent outcomes and Decision options are outcomes: each must be a valid
 * label, unique within its node and not reserved for the engine. One
 * without an edge is allowed, but ending on it ends the run there: a warning,
 * except an Agent's own `fail` or `needs-input`, which fail the step anyway.
 */
function checkOptions(
	node: Extract<FlowNode, { type: "agent" | "decision" | "command" }>,
	flow: Flow,
	error: Report,
	warning: Report,
): void {
	const { title, kind } = optionWords[node.type];
	const picker =
		node.type === "decision"
			? pickerWords[node.by]
			: optionWords[node.type].picker;
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
		// A command ends the run on exit 0 and fails it on any other code.
		const failing =
			node.type === "command" ||
			(node.type === "agent" && (name === "fail" || name === "needs-input"));
		if (!routed && !failing) {
			warning(
				`${title} node "${node.id}" has no edge for "${name}": the run ends there when ${picker} "${name}".`,
				at,
			);
		}
	}
}

/**
 * Each exit code at most once. The catch-all (an exit without a code) at
 * most once and last. Without one, an exit code that is not listed errors
 * the step: a warning.
 */
function checkExits(node: CommandNode, error: Report, warning: Report): void {
	const at = { nodeId: node.id };
	const codes = new Set<number>();
	const exits = commandExits(node);
	for (const exit of exits) {
		if (exit.code === undefined) continue;
		if (codes.has(exit.code)) {
			error(
				`Command node "${node.id}" has the exit code ${exit.code} more than once.`,
				at,
			);
		}
		codes.add(exit.code);
	}
	const catchAll = exits.filter((exit) => exit.code === undefined);
	if (catchAll.length > 1) {
		error(
			`Command node "${node.id}" has ${catchAll.length} exits without a code (${catchAll.map((e) => `"${e.name}"`).join(", ")}). Keep one: it catches every other code.`,
			at,
		);
	} else if (catchAll.length === 1 && exits.at(-1) !== catchAll[0]) {
		error(
			`Command node "${node.id}": the exit "${catchAll[0]?.name}" catches every other code. Put it last.`,
			at,
		);
	} else if (catchAll.length === 0) {
		warning(
			`Command node "${node.id}" has no exit for other codes: the step fails on any code that is not listed.`,
			at,
		);
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
