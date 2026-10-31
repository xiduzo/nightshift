/**
 * The flow draft in the editor's words: summaries, picker labels, template
 * chips and the messages of a check. The edits themselves live in
 * `@nightshift/flows` (the draft vertical).
 */
import {
	type CliToolRef,
	checkDraft,
	type DraftMessages,
	type Flow,
	type FlowCheck,
	type FlowNode,
	isOptionNode,
	type ListSource,
	nodeOptions,
	type ProfileRef,
	type ProjectFlowMap,
	type TemplateField,
	type TemplateNode,
	templateScope,
	type WaitUntil,
} from "@nightshift/flows";

/** How each kind of wait reads in a picker. */
export const WAIT_KINDS: Record<WaitUntil["kind"], string> = {
	duration: "A duration",
	time: "A time",
	command: "A command",
	signal: "A signal",
};

/** How each kind of list source reads in a picker. */
export const SOURCE_KINDS: Record<ListSource["kind"], string> = {
	json: "A JSON value",
	command: "A command",
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

/** What the editor says about a profile that its device does not have. */
export function missingProfileMessage(_profile: ProfileRef): string {
	return "Its device no longer has this profile. The flow cannot run until you pick another profile.";
}

/**
 * What the editor says about a node that names a device you cannot use:
 * the run does not start. A Subflow names a computer.
 */
export function missingDeviceMessage(
	name: string,
	node: Pick<FlowNode, "type">,
): string {
	return `You have no ${node.type === "call" ? "computer" : "device"} named ${name}. Pick another one so the run can start.`;
}

/** What the editor says about a command that calls a program without the login of its CLI tool. */
export function programWithoutLoginMessage(
	program: string,
	tools: readonly string[],
): string {
	const each = tools.length === 1 ? "it runs" : "each runs";
	return `${program} runs without a login in a command. Use ${tools.join(" or ")} instead: ${each} ${program} signed in.`;
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

/**
 * The `{{…}}` variables a field can use, in groups: the template scope of
 * `@nightshift/flows` (what the checks accept), in the editor's words. The
 * node `nodeId` is left out (null: every node counts). `flows` adds the
 * outputs of the flows that Subflow nodes call. `initialValue`: a
 * variable's initial value, which reads the inputs and run only.
 */
export function templateVariables(
	flow: Flow,
	nodeId: string | null,
	options: { flows?: ProjectFlowMap; initialValue?: boolean } = {},
): VariableGroup[] {
	const scope = templateScope(flow, options);
	const groups: VariableGroup[] = [];
	if (scope.inputs.length > 0) {
		groups.push({
			scope: "inputs",
			variables: scope.inputs.map((field) =>
				variableOf(field, field.name, field.description),
			),
		});
	}
	if (scope.vars && scope.vars.length > 0) {
		groups.push({
			scope: "vars",
			variables: scope.vars.map((field) => {
				const type =
					flow.variables?.find((variable) => variable.name === field.name)
						?.type ?? "text";
				return variableOf(
					field,
					field.name,
					field.description ? `${type}: ${field.description}` : type,
				);
			}),
		});
	}
	for (const node of scope.nodes) {
		if (node.id === nodeId) continue;
		const own = flow.nodes.find((candidate) => candidate.id === node.id);
		groups.push({ scope: node.id, variables: nodeVariables(node, own) });
	}
	groups.push({
		scope: "run",
		variables: scope.run.map((field) => variableOf(field, field.name)),
	});
	return groups;
}

/** A node's fields, then the keys its output schema names below `data`. */
function nodeVariables(
	node: TemplateNode,
	own: FlowNode | undefined,
): TemplateVariable[] {
	const keyWords =
		own?.type === "value"
			? "A field of the value"
			: "A field of the output schema";
	return [
		...node.fields.map((field) =>
			variableOf(
				field,
				field.name,
				field.output
					? (field.description ??
							`An output of ${own?.type === "call" ? own.flow : "the called flow"}`)
					: undefined,
			),
		),
		...node.fields.flatMap((field) =>
			(field.keys ?? []).map((key) =>
				variableOf(key, `${field.name}.${key.name}`, keyWords),
			),
		),
	];
}

function variableOf(
	field: TemplateField,
	label: string,
	description?: string,
): TemplateVariable {
	return {
		text: `{{${field.ref}}}`,
		label,
		json: field.json,
		...(description === undefined ? {} : { description }),
	};
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
	maxTurns: "Max turns must be a whole number above 0.",
	flow: "Pick a flow to run.",
	"each.as": "Pick the input that gets the item.",
	"each.source.value": "Set the list: a template that gives a JSON array.",
	"each.source.command": "The source command is empty.",
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
	budgetUsd: "Run policy: the budget must be above 0.",
	maxTurns: "Run policy: max turns must be a whole number above 0.",
	idleMinutes: "Run policy: the idle timeout must be above 0.",
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
			(scope === "policy" ? POLICY_MESSAGES[String(index)] : undefined) ??
			`${field || String(scope)}: ${issue.message}`
		);
	},
	missingConnection: missingConnectionMessage,
	missingProfile: missingProfileMessage,
	missingDevice: missingDeviceMessage,
	programWithoutLogin: programWithoutLoginMessage,
};

/** A `{{` the cursor is in: where it starts, and the name typed after it so far. */
export type OpenTemplate = { start: number; query: string };

/**
 * The `{{` just before the cursor that is not closed yet, or null. `{{plan`
 * gives `plan`. Its own pattern: `TEMPLATE_REF` of `@nightshift/flows` only
 * matches a reference with its closing braces.
 */
export function openTemplate(
	text: string,
	cursor: number,
): OpenTemplate | null {
	const match = /\{\{\s*([\w.-]*)$/.exec(text.slice(0, cursor));
	return match ? { start: match.index, query: match[1] ?? "" } : null;
}

/** The groups again, with only the variables whose reference holds the query. */
export function matchVariables(
	groups: readonly VariableGroup[],
	query: string,
): VariableGroup[] {
	const needle = query.toLowerCase();
	return groups
		.map(({ scope, variables }) => ({
			scope,
			variables: variables.filter((variable) =>
				variable.text.slice(2, -2).toLowerCase().includes(needle),
			),
		}))
		.filter((group) => group.variables.length > 0);
}

/**
 * Puts the variable in place of the open `{{` and the name after it, up to a
 * `}}` that is already there. A JSON value leaves the cursor before the
 * closing braces, ready for a path: `{{planner.data|}}`.
 */
export function completeTemplate(
	text: string,
	cursor: number,
	open: OpenTemplate,
	variable: TemplateVariable,
): { text: string; cursor: number } {
	const rest = /^[\w.-]*(?:\s*\}\})?/.exec(text.slice(cursor))?.[0] ?? "";
	return {
		text:
			text.slice(0, open.start) +
			variable.text +
			text.slice(cursor + rest.length),
		cursor: open.start + variable.text.length - (variable.json ? 2 : 0),
	};
}

/**
 * Checks the draft with `checkDraft`, in the editor's words. `flows` holds
 * the project's flow files by name, so Call nodes can check the flows they
 * call; leave it out while they load. `name` is the draft's own file name.
 * `connections` holds the names of the daemon's connections, and
 * `profiles` the profiles a node may name, each on its device, with the
 * devices whose profiles this computer cannot tell, and `cliTools` the CLI
 * tools; leave them out while they load.
 */
export function checkFlow(
	flow: Flow,
	flows?: ProjectFlowMap,
	name?: string,
	connections?: readonly string[],
	profiles?: {
		known: readonly ProfileRef[];
		untoldDevices: readonly string[];
		/** The names of the devices a run may use: a node that names another does not start. */
		deviceNames: readonly string[];
	},
	cliTools?: readonly CliToolRef[],
): FlowCheck {
	return checkDraft(flow, MESSAGES, {
		flows,
		name,
		connections,
		cliTools,
		...(profiles
			? {
					profiles: profiles.known,
					untoldDevices: profiles.untoldDevices,
					devices: profiles.deviceNames,
				}
			: {}),
	});
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

/** The first line of a decision's prompt. */
export function firstLine(text: string): string {
	return text.trim().split("\n")[0] ?? "";
}
