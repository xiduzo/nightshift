/**
 * The flow draft in the editor's words: summaries, picker labels, template
 * chips and the messages of a check. The edits themselves live in
 * `@nightshift/flows` (the draft vertical).
 */
import {
	type AgentNode,
	calledFlow,
	checkDraft,
	type DraftMessages,
	type Flow,
	type FlowCheck,
	type FlowNode,
	isOptionNode,
	type ListSource,
	nameSchema,
	nodeOptions,
	nodeOutputFields,
	type Policy,
	type ProjectFlowMap,
	runFields,
	type ValueNode,
	type WaitUntil,
} from "@nightshift/flows";

/** The first line of what makes the value: the expression, or the prompt. */
export function valueSummary(node: ValueNode): string {
	return firstLine((node.by === "rule" ? node.expression : node.prompt) ?? "");
}

/** How each kind of wait reads in a picker. */
export const WAIT_KINDS: Record<WaitUntil["kind"], string> = {
	duration: "A duration",
	time: "A time",
	command: "A command",
	signal: "A signal",
};

/** One line for a wait: what it waits for. Empty when it is not set yet. */
export function waitSummary(until: WaitUntil): string {
	switch (until.kind) {
		case "duration":
			return `${until.minutes} min`;
		case "time":
			return until.at.trim();
		case "command":
			return until.command.trim().split("\n")[0] ?? "";
		case "signal":
			return until.name.trim();
	}
}

/** How each kind of list source reads in a picker. */
export const SOURCE_KINDS: Record<ListSource["kind"], string> = {
	json: "A JSON value",
	command: "A command",
	files: "Files (a glob)",
};

/** One line for a source: where the elements come from. Empty when it is not set yet. */
export function sourceSummary(source: ListSource): string {
	switch (source.kind) {
		case "json":
			return source.value.trim();
		case "command":
			return source.command.trim().split("\n")[0] ?? "";
		case "files":
			return source.glob.trim();
	}
}

/**
 * The built-in defaults of the run policy. A number the flow leaves out comes
 * from the daemon's settings; these stand in while the settings load.
 */
export const POLICY_DEFAULTS: Required<Policy> = {
	usageLimitFirstWaitMinutes: 5,
	usageLimitMaxWaitMinutes: 60,
	networkGraceMinutes: 240,
	maxSteps: 500,
	resumeInterruptedRuns: true,
};

/** What an option is called on its node: an option, an outcome, or an exit. */
export function optionNoun(node: FlowNode): "option" | "outcome" | "exit" {
	if (node.type === "decision") return "option";
	return node.type === "command" ? "exit" : "outcome";
}

/** What the editor says about a connection the daemon does not have. */
export function missingConnectionMessage(name: string): string {
	return `No connection named ${name}. The flow cannot run until you add it on the Agents page.`;
}

/** What the editor says about a profile the daemon does not have. */
export function missingProfileMessage(name: string): string {
	return `No profile named ${name}. The flow cannot run until you add it on the Agents page.`;
}

/** One `{{…}}` a template can use. */
export type TemplateVariable = {
	/** The full reference, `{{planner.data}}`. */
	text: string;
	/** What the chip shows, `data`. */
	label: string;
	/** Holds JSON: a path can go below it, `{{planner.data.tasks}}`. */
	json: boolean;
	/** Shown as the chip's tooltip. */
	description?: string;
};

export type VariableGroup = {
	/** A node id, `inputs`, `vars`, or `run`. */
	scope: string;
	variables: TemplateVariable[];
};

/** The top-level keys of a JSON Schema object, with whether each holds JSON. */
export function schemaFields(
	schema: unknown,
): { name: string; json: boolean }[] {
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
			return { name, json: type === "array" || type === "object" };
		});
}

const JSON_FIELDS: readonly string[] = ["data", "results"];

function nodeVariables(
	node: FlowNode,
	flows: ProjectFlowMap | undefined,
): TemplateVariable[] {
	const called = calledFlow(node, flows);
	const own: readonly string[] = nodeOutputFields(node);
	const variables: TemplateVariable[] = nodeOutputFields(node, called).map(
		(field) => {
			const output = own.includes(field)
				? undefined
				: called?.outputs.find((candidate) => candidate.name === field);
			return {
				text: `{{${node.id}.${field}}}`,
				label: field,
				// A called flow's output may hold JSON: a path can go below it.
				json: JSON_FIELDS.includes(field) || output !== undefined,
				description: output
					? (output.description ??
						`An output of ${node.type === "call" ? node.flow : "the called flow"}`)
					: undefined,
			};
		},
	);
	if (node.type === "agent") {
		for (const field of schemaFields(node.output)) {
			variables.push({
				text: `{{${node.id}.data.${field.name}}}`,
				label: `data.${field.name}`,
				json: field.json,
				description: "A field of the output schema",
			});
		}
	}
	if (node.type === "value") {
		for (const field of schemaFields(node.output)) {
			variables.push({
				text: `{{${node.id}.data.${field.name}}}`,
				label: `data.${field.name}`,
				json: field.json,
				description: "A field of the value",
			});
		}
	}
	return variables;
}

/**
 * The `{{…}}` variables a node can use: the flow's inputs, its variables,
 * other nodes' outputs, and the run's fields. With `nodeId` null (the flow's outputs),
 * every node counts. `flows` adds the outputs of the flows that Call
 * nodes call.
 */
export function templateVariables(
	flow: Flow,
	nodeId: string | null,
	flows?: ProjectFlowMap,
): VariableGroup[] {
	const inputs: VariableGroup[] =
		flow.inputs.length > 0
			? [
					{
						scope: "inputs",
						variables: flow.inputs.map((input) => ({
							text: `{{${input.name}}}`,
							label: input.name,
							json: input.type === "json",
							description: input.description ?? input.label,
						})),
					},
				]
			: [];
	const variables = flow.variables ?? [];
	const vars: VariableGroup[] =
		variables.length > 0
			? [
					{
						scope: "vars",
						variables: variables.map((variable) => ({
							text: `{{vars.${variable.name}}}`,
							label: variable.name,
							json: variable.type === "json",
							description: variable.description
								? `${variable.type}: ${variable.description}`
								: variable.type,
						})),
					},
				]
			: [];
	const nodes = flow.nodes
		.filter((node) => node.id !== nodeId)
		.map((node) => ({
			scope: node.id,
			variables: nodeVariables(node, flows),
		}));
	return [
		...inputs,
		...vars,
		...nodes,
		{
			scope: "run",
			variables: runFields.map((field) => ({
				text: `{{run.${field}}}`,
				label: field,
				json: false,
			})),
		},
	];
}

const FIELD_MESSAGES: Record<string, string> = {
	command: "The command is empty.",
	prompt: "Write the prompt.",
	options: "A decision needs at least one option.",
	outcomes: "An agent with its own outcomes needs at least one.",
	output: "The output schema must be a JSON object.",
	model: "Set a model.",
	skill: "The skill name is empty.",
	timeoutMinutes: "The timeout must be a whole number of minutes above 0.",
	max: "The max must be a whole number above 0.",
	id: "Use lowercase letters, digits and _, starting with a letter.",
	idleMinutes: "The idle timeout must be a whole number of minutes above 0.",
	flow: "Pick a flow to run.",
	"each.as": "Pick the input that gets the item.",
	"each.source.value": "Set the list: a template that gives a JSON array.",
	"each.source.command": "The source command is empty.",
	"each.source.glob": "The glob is empty.",
	"each.maxItems": "Max items must be a whole number above 0.",
	expression: "Write the expression.",
	"until.minutes": "The wait must be a whole number of minutes above 0.",
	"until.at": "Set the time to wait for.",
	"until.command": "The command to wait for is empty.",
	"until.everyMinutes":
		"The interval must be a whole number of minutes above 0.",
	"until.name":
		"Signal name: use lowercase letters, digits and -, starting with a letter.",
	connection: "Pick an MCP server.",
	tool: "Pick a tool.",
};

const POLICY_MESSAGES: Record<string, string> = {
	usageLimitFirstWaitMinutes:
		"Run policy: the first usage-limit wait must be above 0.",
	usageLimitMaxWaitMinutes:
		"Run policy: the longest usage-limit wait must be above 0.",
	networkGraceMinutes: "Run policy: the network grace must be above 0.",
	maxSteps: "Run policy: max steps must be a whole number above 0.",
};

/** The words of a draft check: what the editor says about each issue. */
const MESSAGES: DraftMessages = {
	schemaIssue: (flow, issue) => {
		const [scope, index, ...rest] = issue.path;
		if (scope === "start") return "Pick a start node.";
		const field = rest.map(String).join(".");
		return (
			ioMessage(flow, scope, index, rest) ??
			writeMessage(flow, scope, index, rest) ??
			FIELD_MESSAGES[field] ??
			optionMessage(flow, index, rest) ??
			bindingMessage(scope, index, rest) ??
			haltOnMessage(flow, index, rest) ??
			mcpMessage(flow, index, rest) ??
			(scope === "policy" ? POLICY_MESSAGES[String(index)] : undefined) ??
			`${field || String(scope)}: ${issue.message}`
		);
	},
	missingConnection: missingConnectionMessage,
	missingProfile: missingProfileMessage,
};

/**
 * Checks the draft with `checkDraft`, in the editor's words. `flows` holds
 * the project's flow files by name, so Call nodes can check the flows they
 * call; leave it out while they load. `name` is the draft's own file name.
 * `connections` and `profiles` hold the names of the daemon's connections
 * and Agent Profiles; leave them out while they load.
 */
export function checkFlow(
	flow: Flow,
	flows?: ProjectFlowMap,
	name?: string,
	connections?: readonly string[],
	profiles?: readonly string[],
): FlowCheck {
	return checkDraft(flow, MESSAGES, { flows, name, connections, profiles });
}

/** A bad label, choice or outcome name: `labels.1.name` reads as `Label "Yes": …`. */
function optionMessage(
	flow: Flow,
	index: PropertyKey | undefined,
	rest: PropertyKey[],
): string | undefined {
	const [list, at, field] = rest;
	if (
		(list !== "options" && list !== "outcomes" && list !== "exits") ||
		field !== "name"
	)
		return;
	const node = typeof index === "number" ? flow.nodes[index] : undefined;
	if (!node || !isOptionNode(node)) return;
	const name = nodeOptions(node)[Number(at)]?.name ?? "";
	const kind =
		list === "options" ? "Option" : list === "exits" ? "Exit" : "Outcome";
	return name === ""
		? `A ${kind.toLowerCase()} has no name.`
		: `${kind} "${name}": use lowercase letters, digits and -, starting with a letter.`;
}

/** A bad input or output of the flow: `inputs.0.name` reads as `Input "Epic": …`. */
function ioMessage(
	flow: Flow,
	scope: PropertyKey | undefined,
	index: PropertyKey | undefined,
	rest: PropertyKey[],
): string | undefined {
	if (
		(scope !== "inputs" && scope !== "outputs" && scope !== "variables") ||
		typeof index !== "number"
	)
		return;
	const kind =
		scope === "inputs" ? "Input" : scope === "outputs" ? "Output" : "Variable";
	const list =
		scope === "inputs"
			? flow.inputs
			: scope === "outputs"
				? flow.outputs
				: (flow.variables ?? []);
	const name = list[index]?.name ?? "";
	if (rest[0] !== "name") {
		return `${kind} "${name}": ${rest.map(String).join(".")} is not valid.`;
	}
	return name === ""
		? `An ${kind.toLowerCase()} has no name.`
		: `${kind} "${name}": use lowercase letters, digits and _, starting with a letter.`;
}

/** A bad variable write of a node: `set.0.variable` reads as `Set variables: …`. */
function writeMessage(
	flow: Flow,
	scope: PropertyKey | undefined,
	index: PropertyKey | undefined,
	rest: PropertyKey[],
): string | undefined {
	const [list, at, field, outcome] = rest;
	if (scope !== "nodes" || list !== "set" || typeof index !== "number") return;
	const write = flow.nodes[index]?.set?.[Number(at)];
	if (field === "variable") {
		return write?.variable
			? `Set variables: "${write.variable}" is not a valid variable name.`
			: "Set variables: pick a variable.";
	}
	if (field === "on") {
		const name = write?.on?.[Number(outcome)] ?? "";
		return `Set variables: "${name}" is not a valid outcome.`;
	}
	return `Set variables: ${rest.slice(2).map(String).join(".")} is not valid.`;
}

/** A binding to a name that cannot be an input of the called flow. */
function bindingMessage(
	scope: PropertyKey | undefined,
	index: PropertyKey | undefined,
	rest: PropertyKey[],
): string | undefined {
	const [list, key] = rest;
	if (scope !== "nodes" || list !== "inputs" || typeof index !== "number")
		return;
	return `The binding "${String(key)}" is not a valid input name.`;
}

/** A bad halt-on label: `each.haltOn.0` reads as `Halt-on label "Stop": …`. */
function haltOnMessage(
	flow: Flow,
	index: PropertyKey | undefined,
	rest: PropertyKey[],
): string | undefined {
	const [group, list, at] = rest;
	if (group !== "each" || list !== "haltOn") return;
	const node = typeof index === "number" ? flow.nodes[index] : undefined;
	if (node?.type !== "call" || !node.each) return;
	const name = node.each.haltOn[Number(at)] ?? "";
	return name === ""
		? "A halt-on label has no name."
		: `Halt-on label "${name}": use lowercase letters, digits and -, starting with a letter.`;
}

function mcpMessage(
	flow: Flow,
	index: PropertyKey | undefined,
	rest: PropertyKey[],
): string | undefined {
	const [field, name, key] = rest;
	if (field !== "mcpServers" || typeof index !== "number") return;
	if (!nameSchema.safeParse(name).success) {
		return `MCP server "${String(name ?? "")}": use lowercase letters, digits and _, starting with a letter.`;
	}
	if (key === "url") {
		return `MCP server "${String(name)}": set a full URL, such as https://mcp.example.com/mcp.`;
	}
	if (key === "command") {
		return `MCP server "${String(name)}": set the command to run.`;
	}
	return flow.nodes[index]?.type === "agent"
		? `MCP server "${String(name)}": ${rest.slice(2).map(String).join(".")} is not valid.`
		: undefined;
}

/** The first line of a prompt, or the skill call when the prompt is empty. */
export function agentSummary(node: AgentNode): string {
	const firstLine = node.prompt.trim().split("\n")[0] ?? "";
	if (node.skill) return `/${node.skill}${firstLine ? ` ${firstLine}` : ""}`;
	return firstLine;
}

/** The first line of a decision's prompt. */
export function firstLine(text: string): string {
	return text.trim().split("\n")[0] ?? "";
}
