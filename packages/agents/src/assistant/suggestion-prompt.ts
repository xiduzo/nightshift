/**
 * The prompt of a field suggestion: one shared frame (the role, the draft,
 * the person's instruction, the guide to flows) around one task per kind.
 * Each kind brings its own instruction and its own context: exactly what
 * that field needs, such as the outgoing edges for outcomes or the
 * project's scripts for a command.
 */
import {
	type Flow,
	type FlowNode,
	flowAuthoringGuide,
	isFlowSuggestion,
	nodeOutcomes,
	type SuggestionKind,
	type SuggestionRequest,
} from "@nightshift/flows";
import type { ProjectFacts } from "./project-facts";
import { dataReaders, draftSummary, flowJson, scopeList } from "./prompts";

/** What a task builds its context from. */
type TaskInput = {
	request: SuggestionRequest;
	flow: Flow;
	/** The node, for a kind of a node. */
	node: FlowNode;
	/** The project's scripts, for a command. */
	facts: ProjectFacts | null;
};

/** One kind: what it suggests, in the frame's first line, and its task with its context. */
type KindPrompt<Input = TaskInput> = {
	what: string;
	task: (input: Input) => string[];
};

/** The kinds that fill a field of the flow, not of a node. */
type FlowKind = "description" | "inputs";

const SELECTION_START = "⟦SELECTION⟧";
const SELECTION_END = "⟦/SELECTION⟧";

const json = (value: unknown) =>
	["```json", JSON.stringify(value, null, 2), "```"].join("\n");

const quoted = (names: readonly string[]) =>
	names.map((name) => `\`${name}\``).join(", ");

/** The edges that leave `node`: each outcome and where it goes. */
function outgoing(flow: Flow, node: FlowNode): string[] {
	const edges = flow.edges.filter((edge) => edge.from === node.id);
	if (edges.length === 0) return ["No edge leaves this node yet."];
	return edges.map((edge) => {
		const to = flow.nodes.find((n) => n.id === edge.to);
		const what = to
			? `\`${to.id}\` (${to.type}${to.label ? `, "${to.label}"` : ""})`
			: `\`${edge.to}\``;
		return `- on \`${edge.outcome}\` → ${what}${edge.max ? `, at most ${edge.max} times` : ""}`;
	});
}

/** The nodes whose templates or rules read `{{<id>.outcome}}`. */
function outcomeReaders(flow: Flow, nodeId: string): string[] {
	const pattern = new RegExp(`(?<![A-Za-z0-9_.])${nodeId}\\.outcome\\b`);
	return flow.nodes
		.filter((node) => node.id !== nodeId && pattern.test(JSON.stringify(node)))
		.map((node) => node.id);
}

/** A node in one line: its id, type and label, and the start of its prompt or command. */
function nodeLine(node: FlowNode): string {
	const text =
		"prompt" in node && typeof node.prompt === "string"
			? node.prompt
			: node.type === "command"
				? node.command
				: "";
	const short = text.replace(/\s+/g, " ").trim().slice(0, 160);
	return `- \`${node.id}\` (${node.type}${node.label ? `, "${node.label}"` : ""})${short ? `: ${short}` : ""}`;
}

/** Names that templates of the flow read but that are no input, node, `run` or `vars`. */
function undeclaredNames(flow: Flow): { name: string; readers: string[] }[] {
	const known = new Set([
		"run",
		"vars",
		...flow.inputs.map((input) => input.name),
		...flow.nodes.map((node) => node.id),
	]);
	const found = new Map<string, Set<string>>();
	for (const node of flow.nodes) {
		for (const match of JSON.stringify(node).matchAll(
			/\{\{\s*([a-z][a-z0-9_]*)/g,
		)) {
			const name = match[1] as string;
			if (known.has(name)) continue;
			const readers = found.get(name) ?? new Set<string>();
			readers.add(node.id);
			found.set(name, readers);
		}
	}
	return [...found].map(([name, readers]) => ({
		name,
		readers: [...readers],
	}));
}

/** Where each input is read: the nodes whose templates name it. */
function inputReaders(flow: Flow, name: string): string[] {
	const pattern = new RegExp(`\\{\\{\\s*${name}\\b`);
	return flow.nodes
		.filter((node) => pattern.test(JSON.stringify(node)))
		.map((node) => node.id);
}

const promptKind: KindPrompt = {
	what: "a prompt",
	task: ({ request, node }) => {
		const current = (node as { prompt?: string }).prompt ?? "";
		const what =
			node.type === "decision"
				? node.by === "person"
					? "the question a person answers to pick one of the node's options"
					: "the question a model reads to pick one of the node's options"
				: node.type === "value"
					? "the brief a model reads to make the node's value"
					: "the message to the coding agent that runs this step";
		const lines = [
			`Write the node's prompt: ${what}.`,
			"",
			"Rules:",
			"- Keep every `{{reference}}` the current prompt has, unless the instruction says to drop it.",
			"- Use only the references listed above. Weave in the ones the instruction or the task implies, where the agent needs that value.",
			"- Write to the agent: plain, imperative sentences. Say what to do, with what, and what done looks like.",
			"- Do not invent file names, commands or tools: read the project when you need them.",
		];
		if (node.type === "agent" && node.output) {
			lines.push(
				"- The node has an output schema: say what the agent must report in it, by field.",
			);
		}
		if (node.type === "agent" && node.outcomes) {
			lines.push(
				`- Say when to end with each outcome: ${quoted(node.outcomes.map((o) => o.name))}.`,
			);
		}
		const { selection } = request;
		if (selection && selection.end > selection.start) {
			const start = Math.min(selection.start, current.length);
			const end = Math.min(selection.end, current.length);
			lines.push(
				"",
				`Rewrite only the part between ${SELECTION_START} and ${SELECTION_END}. \`text\` replaces that part, so it must fit the text around it. Leave out the markers.`,
				"",
				"The current prompt:",
				"```",
				current.slice(0, start) +
					SELECTION_START +
					current.slice(start, end) +
					SELECTION_END +
					current.slice(end),
				"```",
			);
		} else {
			lines.push(
				"",
				"`text` is the whole new prompt.",
				"",
				current.trim() === ""
					? "The node has no prompt yet."
					: ["The current prompt:", "```", current, "```"].join("\n"),
			);
		}
		return lines;
	},
};

const outputKind: KindPrompt = {
	what: "an output schema",
	task: ({ flow, node }) => {
		const readers = dataReaders(flow, node.id);
		const current = (node as { output?: unknown }).output;
		return [
			`Write the node's output schema: a JSON Schema for an object (\`"type": "object"\`, \`properties\`, \`required\`). The step's \`data\` must match it, and the rest of the flow reads it as \`{{${node.id}.data.<field>}}\`.`,
			"",
			"Rules:",
			"- Keep the fields the rest of the flow reads (below), with a type that fits how they are read.",
			"- Add the fields the node's prompt asks the agent to report.",
			"- Give each property a short `description`. Prefer simple types: string, number, boolean, arrays and objects of those.",
			"- Keep it small: only fields someone reads or the person asked for.",
			"",
			readers.length > 0
				? [
						"What the rest of the flow reads from this node's data:",
						...readers.map(
							(r) => `- \`${r.key}\`: read by ${r.readers.join(", ")}`,
						),
					].join("\n")
				: "No other node reads this node's data yet.",
			"",
			current
				? `The current output schema:\n${json(current)}`
				: "The node has no output schema yet.",
		];
	},
};

const setKind: KindPrompt = {
	what: "variable writes",
	task: ({ flow, node }) => [
		"Write the node's variable writes (`set`): what this step stores in the flow's variables when it ends, so later steps can read it as `{{vars.<name>}}`.",
		"",
		"Each write: `{ variable, value?, expression?, on? }`, with exactly one of `value` and `expression`:",
		`- \`value\`: a template, for example \`{{${node.id}.summary}}\`. One reference alone keeps its JSON value.`,
		"- `expression`: a JSONata expression over the run's values, `vars` included, for example `vars.tries + 1`.",
		`- \`on\`: the outcomes that write, from ${quoted(nodeOutcomes(node))}. Leave it out to write on every outcome.`,
		"",
		"Rules:",
		"- `set` replaces the node's writes: keep the current ones that still make sense.",
		"- Use only references listed above.",
		'- Put each variable a write needs that the flow does not declare yet in `variables`: `{ name, type: "text" | "number" | "boolean" | "json", description?, initial? }`. Leave out the ones the flow declares.',
		"",
		node.set && node.set.length > 0
			? `The current writes:\n${json(node.set)}`
			: "The node writes no variables yet.",
		"",
		(flow.variables ?? []).length > 0
			? `The flow's variables:\n${json(flow.variables)}`
			: "The flow declares no variables yet.",
	],
};

const outcomesKind: KindPrompt = {
	what: "outcomes",
	task: ({ flow, node }) => {
		const decision = node.type === "decision" ? node : null;
		const words = decision ? "options" : "own outcomes";
		const current = decision
			? decision.options
			: node.type === "agent"
				? node.outcomes
				: undefined;
		const readers = outcomeReaders(flow, node.id);
		const lines = [
			decision
				? `Write the Decision's options: the answers it picks from. Each option is an outcome with its own edge. ${
						decision.by === "person"
							? "A person picks one: each option is a button in their inbox."
							: decision.by === "model"
								? "A model picks one: its `description` tells the model when to pick it."
								: "A rule picks one: the first option whose `when` holds. The last option has no `when`: it is the default."
					}`
				: "Write the Agent's own outcomes: the ways its step can end. The agent reports exactly one, and each has its own edge. They replace `pass`, `fail` and `needs-input`.",
			"",
			"Each outcome: `{ name, description?, color?, from?" +
				(decision?.by === "rule" ? ", when?" : "") +
				" }`.",
			"- `name`: lowercase letters, digits and `-`, starting with a letter, at most 30 characters, such as `approved` or `changes-requested`. Not `error`, `stopped`, `interrupted` or `waiting`.",
			"- `description`: one sentence on when to pick it. Always give one.",
			"- `from`: the current outcome this one replaces, so its edge moves to the new name. Without `from`, a current outcome you leave out loses its edge.",
			...(decision?.by === "rule"
				? ["- `when`: leave it out to keep the rule of the option it replaces."]
				: []),
			...(decision
				? []
				: [
						"- Keep `fail` when the work can fail: a step that ends `fail` fails the run unless an edge catches it.",
					]),
			"",
			"Rules:",
			"- Two to four outcomes, each a different next step. Read the node's prompt: what results does it describe?",
			"- Fit the edges that leave the node now (below). Keep the outcomes that have an edge, or rename them with `from`.",
			"- Prefer names a person understands on the canvas.",
			"",
			"The node's prompt:",
			"```",
			(node as { prompt?: string }).prompt?.trim() || "(empty)",
			"```",
			"",
			`The node's current ${words}:`,
			current ? json(current) : quoted(nodeOutcomes(node)),
			"",
			"Where the flow goes next from this node:",
			...outgoing(flow, node),
			"",
			readers.length > 0
				? `These nodes read the outcome as \`{{${node.id}.outcome}}\`: ${quoted(readers)}. Keep the names they compare against.`
				: "No node reads the outcome by name.",
		];
		return lines;
	},
};

const RULE_SYNTAX = [
	'A rule is a JSONata expression over the run\'s values. It reads the names of the list above without the braces: a node id or an input name, then a path, such as `build.data.tests_passed = true and check.exit_code = 0`. Variables are `vars.<name>`. Put a name with a dash in backticks: `` `my-input` = "x" ``.',
	"A node that has not run yet reads as empty. Compare with `=`, `!=`, `<`, `>`, and join with `and` and `or`. `$exists(x)` checks a value is there.",
];

const rulesKind: KindPrompt = {
	what: "rules",
	task: ({ node }) => {
		const options = node.type === "decision" ? node.options : [];
		return [
			"Write the rule of each of the Decision's options: the condition that picks it. Night Shift tries the rules from top to bottom and picks the first option whose rule holds.",
			"",
			...RULE_SYNTAX,
			"",
			"Each rule: `{ option, when }`, one per option, in the order of the options.",
			"- `option`: the option's name, exactly as below. Do not add or rename options.",
			'- `when`: the rule. Give the last option `""`: it is the default, picked when no rule holds.',
			"",
			"Rules:",
			"- Use only names the list above has, and the fields their data really has (see the output schemas in the flow).",
			"- Keep each rule short and readable.",
			"",
			"The options and their current rules:",
			json(options),
			"",
			"The node's note on what the rules check:",
			"```",
			(node as { prompt?: string }).prompt?.trim() || "(empty)",
			"```",
		];
	},
};

const expressionKind: KindPrompt = {
	what: "an expression",
	task: ({ node }) => {
		const value = node.type === "value" ? node : null;
		return [
			"Write the Value node's expression: a JSONata expression whose result is the node's data. The result must match the node's output schema (below), or the step fails.",
			"",
			...RULE_SYNTAX,
			'JSONata can build objects and lists: `{ "title": plan.data.title }`, `$filter(plan.data.tasks, function($t) { $t.size = "small" })`, `$count(...)`, `$join(..., ", ")`.',
			"",
			"Rules:",
			"- Use only names the list above has, and the fields their data really has (see the output schemas in the flow).",
			"- Make the result fit the output schema exactly: its type and its required fields.",
			"",
			"The node's output schema:",
			json(value?.output ?? {}),
			"",
			value?.expression?.trim()
				? `The current expression:\n\`\`\`\n${value.expression}\n\`\`\``
				: "The node has no expression yet.",
		];
	},
};

function factsLines(facts: ProjectFacts | null): string[] {
	if (!facts) return ["Read the project to find its scripts."];
	const scripts = Object.entries(facts.scripts);
	return [
		facts.packageManager
			? `Package manager: ${facts.packageManager} (from its lock file). Run a script as \`${facts.packageManager} run <script>\`.`
			: "No lock file of a JavaScript package manager.",
		scripts.length > 0
			? [
					"The scripts of package.json:",
					...scripts.map(([name, script]) => `- \`${name}\`: \`${script}\``),
				].join("\n")
			: "No scripts in package.json.",
		facts.taskFiles.length > 0
			? `Other files with commands: ${quoted(facts.taskFiles)}. Read the one you need.`
			: "",
	].filter(Boolean);
}

const commandKind: KindPrompt = {
	what: "a command",
	task: ({ node, facts }) => {
		const wait = node.type === "wait";
		const current =
			node.type === "command"
				? node.command
				: node.type === "wait" && node.until.kind === "command"
					? node.until.command
					: "";
		const lines = [
			wait
				? `Write the command a Wait node runs every ${node.type === "wait" && node.until.kind === "command" ? node.until.everyMinutes : "few"} minutes until it exits 0. Exit 0 means the wait is over; any other code means try again later.`
				: "Write the Command node's command. It runs with `sh -c` in the project's folder, and its exit code picks the outcome.",
			"",
			"Rules:",
			"- Use the project's own scripts and tools (below). Do not invent a script or a program the project does not have.",
			'- A `{{reference}}` reaches the shell as an environment variable, never as shell text: put it in double quotes, `echo "{{plan.summary}}"`.',
			"- Never ask for input, never open an editor or a pager, and never change git history or delete files outside the project's build output.",
			"- Keep it to one line where you can. Chain steps with `&&`.",
		];
		if (node.type === "command") {
			lines.push(
				node.output === "json"
					? "- The node keeps the output as JSON: the command must print one JSON value on stdout."
					: "- Later nodes read the last lines of the output.",
				"",
				"The node's exits (the code, and the outcome it ends on):",
				...(node.exits ?? [{ name: "pass", code: 0 }, { name: "fail" }]).map(
					(exit) =>
						`- ${exit.code === undefined ? "any other code" : exit.code} → \`${exit.name}\`${exit.description ? `: ${exit.description}` : ""}`,
				),
			);
		}
		lines.push(
			"",
			"# The project",
			"",
			...factsLines(facts),
			"",
			current.trim() === ""
				? "The node has no command yet."
				: `The current command:\n\`\`\`sh\n${current}\n\`\`\``,
		);
		return lines;
	},
};

const checkerKind: KindPrompt = {
	what: "what the checker looks for",
	task: ({ node }) => {
		const agent = node.type === "agent" ? node : null;
		const outcomes =
			agent?.outcomes ?? nodeOutcomes(node).map((name) => ({ name }));
		return [
			"Write the brief of the checker: a small model that reads the agent's report (its summary, its final message and its data) after the step and picks the outcome. `text` is that brief.",
			"",
			"Rules:",
			"- Say for each outcome what in the report makes it the right pick. Name the data fields to look at.",
			"- Be strict where it matters: a pass needs evidence, such as tests that ran and passed.",
			"- A few short sentences. Templates work, but the model already gets the task and the report.",
			"",
			"The outcomes to pick from:",
			json(outcomes),
			"",
			"The agent's prompt:",
			"```",
			agent?.prompt.trim() || "(empty)",
			"```",
			"",
			agent?.output
				? `The agent's output schema:\n${json(agent.output)}`
				: "The agent reports no structured data.",
			"",
			agent?.checker?.prompt?.trim()
				? `The current brief:\n\`\`\`\n${agent.checker.prompt}\n\`\`\``
				: "The checker has no brief yet.",
		];
	},
};

const argumentsKind: KindPrompt = {
	what: "the arguments of a tool call",
	task: ({ request, node }) => {
		const tool = node.type === "tool" ? node : null;
		return [
			`Write the arguments of the call to the tool \`${tool?.tool ?? ""}\` of the MCP server \`${tool?.connection ?? ""}\`. \`arguments\` maps each argument's name to a template.`,
			"",
			"Rules:",
			"- Fill every required argument. Add an optional one only when the flow has a value for it.",
			"- Use the names of the tool's input schema exactly. Do not invent arguments.",
			"- A template that is one reference keeps its JSON value: `{{plan.data.tasks}}` stays a list. Other text is a string, read as the type the schema says.",
			"- Use only references listed above. Plain text is fine for a fixed value.",
			"",
			request.toolSchema
				? `The tool's input schema:\n${json(request.toolSchema)}`
				: "The tool's input schema is not known: keep the current argument names, and add one only when the instruction names it.",
			"",
			tool && Object.keys(tool.arguments).length > 0
				? `The current arguments:\n${json(tool.arguments)}`
				: "The node has no arguments yet.",
		];
	},
};

const descriptionKind: KindPrompt<{ flow: Flow }> = {
	what: "a description",
	task: ({ flow }) => [
		"Write the flow's description: what it does and what it gives you, for a person who picks a flow to run. `description` is that text.",
		"",
		"Rules:",
		"- One or two plain sentences, at most 30 words. Lead with what it does.",
		"- Say what starts it or what it needs, and what you get at the end.",
		"- No node ids, no file names, no internals.",
		"",
		"The flow in short:",
		draftSummary(flow),
		"",
		"Its steps:",
		...flow.nodes.map(nodeLine),
	],
};

const inputsKind: KindPrompt<{ flow: Flow }> = {
	what: "inputs",
	task: ({ flow }) => {
		const missing = undeclaredNames(flow);
		return [
			"Write the flow's inputs: the values a person gives when they start a run, or a calling flow passes in. `inputs` replaces the flow's inputs.",
			"",
			'Each input: `{ name, type: "text" | "json", label?, description?, default?, required? }`.',
			"- `name`: lowercase letters, digits and `_`, starting with a letter. Templates read it as `{{name}}`.",
			"- `type`: `json` for a value with fields, read with a path (`{{issue.title}}`). Else `text`.",
			"- `description`: one sentence on what to give, with an example. Always give one.",
			"- `required`: true when the flow cannot work without it and there is no `default`.",
			"",
			"Rules:",
			"- Keep every input the flow reads now, with its name: a rename breaks the templates that read it.",
			"- Add the names templates read that the flow does not declare (below).",
			"- Add an input only for a value that changes from run to run. Leave out what the flow can find itself.",
			"",
			flow.inputs.length > 0
				? [
						"The current inputs, and the nodes that read each:",
						json(flow.inputs),
						...flow.inputs.map(
							(input) =>
								`- \`${input.name}\`: ${inputReaders(flow, input.name).join(", ") || "not read"}`,
						),
					].join("\n")
				: "The flow has no inputs yet.",
			"",
			missing.length > 0
				? [
						"Names templates read that the flow does not declare:",
						...missing.map(
							(m) => `- \`${m.name}\`: read by ${quoted(m.readers)}`,
						),
					].join("\n")
				: "Every name the templates read is declared.",
			"",
			"Its steps:",
			...flow.nodes.map(nodeLine),
		];
	},
};

/** The prompt of each kind of a node: its own instruction and its own context. */
const NODE_KINDS: Record<Exclude<SuggestionKind, FlowKind>, KindPrompt> = {
	prompt: promptKind,
	output: outputKind,
	set: setKind,
	outcomes: outcomesKind,
	rules: rulesKind,
	expression: expressionKind,
	command: commandKind,
	checker: checkerKind,
	arguments: argumentsKind,
};

/** The prompt of each kind of the flow. */
const FLOW_KINDS: Record<FlowKind, KindPrompt<{ flow: Flow }>> = {
	description: descriptionKind,
	inputs: inputsKind,
};

/** The kind's own lines: what it suggests, and its task with its context. */
function kindPrompt(
	request: SuggestionRequest,
	facts: ProjectFacts | null,
): { what: string; task: string[]; node: FlowNode | undefined } {
	const { flow, nodeId, kind } = request;
	if (isFlowSuggestion(kind)) {
		const spec = FLOW_KINDS[kind as FlowKind];
		return { what: spec.what, task: spec.task({ flow }), node: undefined };
	}
	const node = flow.nodes.find((candidate) => candidate.id === nodeId);
	if (!node) throw new Error(`The flow has no node "${nodeId}".`);
	const spec = NODE_KINDS[kind as Exclude<SuggestionKind, FlowKind>];
	return {
		what: spec.what,
		task: spec.task({ request, flow, node, facts }),
		node,
	};
}

/** The prompt of one suggestion. `facts`: the project's scripts, for a command. */
export function suggestionPrompt(
	request: SuggestionRequest,
	facts: ProjectFacts | null = null,
): string {
	const { flow } = request;
	const { what, task, node } = kindPrompt(request, facts);
	const instruction = request.instruction.trim();
	return [
		`You help a person build a Night Shift flow in its editor. Suggest ${what} for ${node ? "one node" : "the flow"}. You only suggest: never change a file. The person sees your suggestion and applies it or not.`,
		"",
		"Read the project in this folder when it helps you ground the answer: AGENTS.md or CLAUDE.md, the README, the package scripts, the skills (`.claude/skills`, `.agents/skills`), and the code the node works on. Read what you need, then answer. Do not explore further.",
		"",
		`# The flow "${request.flowName}" (the person's draft)`,
		"",
		"```json",
		flowJson(flow),
		"```",
		"",
		...(node
			? [
					`# The node \`${node.id}\` (${node.type})`,
					"",
					"```json",
					flowJson(node),
					"```",
					"",
					"# What a template in this node can read",
					"",
					scopeList(flow, node.id),
					"",
				]
			: []),
		"# Your task",
		"",
		...task,
		"",
		"# The person's instruction",
		"",
		instruction === ""
			? `None. Make the suggestion that fits this ${node ? "node" : "flow"} best.`
			: instruction,
		"",
		"Put a note for the person in `summary`: one or two plain sentences on what you suggest and why. Do not name tools or files of Night Shift itself.",
		"",
		"---",
		"",
		"For reference, how Night Shift flows work:",
		"",
		flowAuthoringGuide(),
	].join("\n");
}
