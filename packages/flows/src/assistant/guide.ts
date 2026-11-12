/**
 * The flow authoring guide: what an agent needs to know to write a valid
 * flow file of the current `FLOW_VERSION`. It goes into every prompt of the
 * assistant and into the `nightshift-flows` skill, so it stays short.
 *
 * The lists in it (node types, outcomes, output fields, reserved names,
 * deciders, colours) come from the schemas and catalogs, and the examples
 * are checked against `flowSchema` and `validateFlow` in the tests, so the
 * guide cannot drift from what the validator accepts.
 */
import {
	FLOW_VERSION,
	type FlowInput,
	type FlowNode,
	type FlowNodeType,
	flowSchema,
	NODE_FAMILIES,
	NODE_FAMILY_LABEL,
	nodeOutcomes,
	outputFieldsByType,
	sectionColors,
	variableTypeSchema,
} from "../flow";
import { ACCEPTED_LEARNINGS_DIR, type Kit, kitList } from "../kits";
import {
	CONVERT_PAIRS,
	callEachOutputFields,
	deciderNameSchema,
	decisionNodeSchema,
	endStatusSchema,
	GATE_TITLE_MAX,
	harnessNameSchema,
	outcomeColors,
	permissionModeSchema,
	reservedNames,
	reservedOutcomes,
	ruleOwnNames,
	valueDeciderNameSchema,
	waitNodeSchema,
} from "../nodes";
import { FEED_ITEM_KEYS } from "../shapes";
import { runFields } from "../template";

const at = { x: 0, y: 0 };

/** A node as a flow file holds it, before defaults apply. */
type NodeInput = FlowInput["nodes"][number];

/** A sample node as the schema reads it, defaults filled in. */
function parsed(node: NodeInput): FlowNode {
	const flow = flowSchema.parse({
		version: FLOW_VERSION,
		start: node.id,
		nodes: [node],
		edges: [],
	});
	return flow.nodes[0] as FlowNode;
}

/** The id of the Device that the profiles of the examples belong to. */
const EXAMPLE_DEVICE = "8c1e4f2a-6b0d-4a7e-9f3c-2d5b7e9a1c4f";

/**
 * One small, valid node per type: the guide shows it, and reads the type's
 * fixed outcomes from it. `satisfies` keeps the list complete.
 */
export const sampleNodes = {
	agent: {
		id: "scout",
		type: "agent",
		position: at,
		profile: { device: EXAMPLE_DEVICE, profile: "worker" },
		prompt: "Find news on {{topic}}. Already reported: {{vars.seen}}",
		output: {
			type: "object",
			properties: { links: { type: "array", items: { type: "string" } } },
		},
	},
	command: {
		id: "check",
		type: "command",
		position: at,
		command: "bun test",
		exits: [
			{ name: "pass", code: 0 },
			{ name: "fail", description: "Any other exit code." },
		],
	},
	tool: {
		id: "ticket",
		type: "tool",
		position: at,
		connection: "jira",
		tool: "getIssue",
		arguments: { key: "{{issue}}" },
	},
	decision: {
		id: "approve",
		type: "decision",
		position: at,
		by: "person",
		prompt: "Send the offer to {{lead}}?",
		options: [{ name: "yes" }, { name: "no" }],
	},
	value: {
		id: "small",
		type: "value",
		position: at,
		by: "rule",
		output: {
			type: "object",
			properties: { tasks: { type: "array" } },
		},
		expression: '{ "tasks": plan.data.tasks[size = "small"] }',
	},
	wait: {
		id: "cool_down",
		type: "wait",
		position: at,
		until: { kind: "duration", minutes: 10 },
	},
	call: {
		id: "each_task",
		type: "call",
		position: at,
		flow: "build-task",
		inputs: { check: "bun test" },
		each: {
			source: { kind: "json", value: "{{plan.data.tasks}}" },
			as: "item",
		},
	},
	end: {
		id: "no_work",
		type: "end",
		position: at,
		status: "nothing-to-do",
		message: "Nothing new about {{topic}}",
	},
	join: {
		id: "reviewed",
		type: "join",
		position: at,
		wait: "all",
	},
	lease: {
		id: "own_branch",
		type: "lease",
		position: at,
		name: "branch:{{pr.data.head}}",
		waitMinutes: 30,
	},
	service: {
		id: "stack",
		type: "service",
		position: at,
		start: "docker compose up -d",
		ready: { url: "http://127.0.0.1:8080/health", timeoutMinutes: 5 },
		stop: "docker compose down",
	},
	"since-last-run": {
		id: "fresh",
		type: "since-last-run",
		position: at,
		items: "{{feed.data.items}}",
		key: "link",
	},
	convert: {
		id: "news",
		type: "convert",
		position: at,
		from: "feed",
		to: "json",
		value: "{{fetch.body}}",
	},
	"web-request": {
		id: "fetch",
		type: "web-request",
		position: at,
		url: "https://api.example.com/items",
		query: { q: "{{topic}}" },
		// biome-ignore lint/suspicious/noTemplateCurlyInString: a secret reference, as a person writes it.
		headers: { Authorization: "Bearer ${API_TOKEN}" },
	},
} as const satisfies Record<FlowNodeType, NodeInput>;

/** What each node type is for, and the fields it adds to the common ones. */
const nodeText: Record<FlowNodeType, string> = {
	agent: `An agent session. \`prompt\` (template) or \`skill\` (runs \`/<skill> <prompt>\`). Name a \`profile\`, or set \`harness\` (${harnessNameSchema.options.join(", ")}, or \`acp:<slug>\`), \`model\` and \`permissionMode\` (${permissionModeSchema.options.join(", ")}) yourself. A profile is better: it names one computer, and the step runs there. Optional: \`fallbacks\` (profiles as \`{ device, profile }\`, first one first, that take the step when the profile's computer cannot; without them the step waits for that computer), \`effort\`, \`session\` (\`fresh\`, or \`resume\` to continue its last session on a later visit), \`clis\` (programs it may run, for example \`gh\`), \`connections\`, \`idleMinutes\`, \`maxTurns\`, \`knowledge\` (the project's knowledge folder: unset gives it when it has files, \`false\` never, a list of its folders such as \`["books", "${ACCEPTED_LEARNINGS_DIR}"]\` gives a copy of those only, search included), \`output\` (a JSON Schema for an object: the agent must report \`data\` that matches it), \`outcomes\` (its own outcomes, each \`{ name, description }\`; replaces the default ones), \`ask: "person"\`. With \`ask: "person"\`, an agent that needs input asks a person in a Gate and takes no edge: "answer" sends the person's note to the same session, "stop" ends the step \`fail\`. Do not draw a \`needs-input\` edge then, and do not build that loop with a Gate yourself. To score the run, the agent reports \`data\` with \`scores\`, as a Command writes them.`,
	command: `A shell command in the project. Its output is the log. To hand on data, it writes JSON to the file named by \`$NS_OUTPUT\`, which becomes \`data\`: \`echo '{"count": 3}' > "$NS_OUTPUT"\`. Data with an \`outcome\` that names one of its exits ends the step on that exit, whatever the exit code; else the exit code picks the outcome. \`exits\` lists \`{ name, code }\`; an exit with \`"code": "data"\` is picked by the data only; one exit without \`code\` catches every other code and goes last. Without \`exits\`: \`pass\` on 0, \`fail\` on any other code. Data with \`scores\` (names to numbers of 0 or more, \`{"scores": {"replicated": 1}}\`) scores the run, and Flow health shows each name. \`stdout: "json"\` reads the JSON printed on stdout instead, when \`$NS_OUTPUT\` stays empty. \`output\` is an optional JSON Schema for \`data\`. \`secrets\` names secrets that reach the command as environment variables. \`$NS_KNOWLEDGE\` is the project's knowledge folder, which agents read: a sync writes markdown there. A template value reaches the shell as an environment variable, never as shell text, so quote it: \`echo "{{build.summary}}"\`. Use double quotes or a heredoc without quotes (\`<<EOF\`). Single quotes and a quoted heredoc (\`<<'EOF'\`) stop the shell from filling in the value: the command gets the variable's name. Call a CLI tool with a login (\`signsIn\` in list_tools) by its name to run its program signed in: \`acli-work jira\`, not \`acli jira\`.`,
	tool: "Calls one tool of a connection (an MCP server of this computer), with no model. `connection`, `tool`, and `arguments` (a template per argument). `data` is the structured result, and `output` its optional JSON Schema.",
	decision: `Picks one of its \`options\` (each \`{ name, description }\`); the option is the outcome. \`by\`: ${decisionNodeSchema.shape.by.options.map((by) => `\`${by}\``).join(", ")}. \`person\` is a Gate: \`prompt\` is the question, and the run waits for the answer. Give it a \`title\`: one line, at most ${GATE_TITLE_MAX} characters, the heading in the inbox. Lists go in the prompt. A Gate may have \`deadline: { at: "07:00", choose: "keep" }\` (or \`minutes\` instead of \`at\`, counted from when it opens): when nobody answered by then, it takes the option \`choose\`. A Gate takes a brief too (see Briefs). \`rule\` is a Branch: each option but the last has \`when\`, a JSONata rule; the first that holds wins, the last option has no rule and is the default. \`model\`: a small model reads \`prompt\` and picks; it reads \`profile\`, or \`decider\` (${deciderNameSchema.options.join(", ")}) and \`model\`, all optional.`,
	value: `Makes \`data\` that matches \`output\` (a JSON Schema for an object). \`by: "rule"\` with \`expression\` (JSONata over the run's values), \`by: "model"\` with \`prompt\` and optionally a \`profile\` or a \`decider\` that can make a value (${valueDeciderNameSchema.options.join(", ")}), or \`by: "person"\` (an Ask, see Asks) with \`prompt\` as the question. Use it to compute or reshape a value, often with \`set\`. Data with \`scores\` scores the run, as on a Command.`,
	wait: `Waits, then ends \`done\`. \`until\` is one of: ${waitNodeSchema.shape.until.options
		.map((option) => `\`${option.shape.kind.value}\``)
		.join(
			", ",
		)} (\`{ kind: "duration", minutes }\`, \`{ kind: "time", at: "07:00" }\`, \`{ kind: "command", command, everyMinutes }\` until it exits 0, \`{ kind: "signal", name, key? }\`, \`{ kind: "any", signal: { name, key? }, command: { command, everyMinutes } }\`: whichever ends it first, \`{ kind: "url", url, everyMinutes, headers? }\` until it answers 2xx, with the body as \`data\`). \`timeoutMinutes\` ends it \`timeout\`. A signal comes from a person on the run page, or from a webhook schedule of the project: then \`data\` holds the webhook (\`{{wait_ci.data.body.check_suite.conclusion}}\`). With \`key\` (a template, for example \`{{pr}}\`), only a webhook whose signal key is that text wakes it. \`outcomes\` (each \`{ name, when? }\`, each with an edge) are more ways out than \`done\`. The command picks one: it writes \`{ "outcome": "red" }\` to \`$NS_OUTPUT\` and exits 0; an unlisted outcome or another exit code polls again. A signal picks the first outcome whose \`when\` (JSONata over \`event\`) holds; a webhook that matches no rule does not wake it. A URL picks by \`when\` over \`data\`.`,
	lease:
		"Lets one run of the Space at a time do the steps after it, also across computers. `name` is a template: `branch:{{pr.data.head}}`, `account:{{account}}`. Night Shift lets go of the lease when the run ends, however it ends. `waitMinutes`: how long it waits for a busy lease (unset: 0). `ttlMinutes` (default 30): how long it outlives a computer that is gone. `scope: { section: <id> }` lets go when the run leaves that Section, which holds the node. Draw a `busy` edge, for example to an End with `nothing-to-do`: without one, `busy` fails the run.",
	service:
		"Starts a process that keeps running while the steps after it work: a Docker Compose stack, a dev server. `start` runs in the background in the project. `ready` is a `command` (exit 0) or a `url` (answers 2xx), tried every `everySeconds` (default 2) up to `timeoutMinutes` (default 5). A ready command can write JSON to `$NS_OUTPUT`, read later as `{{stack.data.url}}`. `{{stack.log_tail}}` gives the last lines of its log. Night Shift stops it when the run ends, however it ends: with `stop` when it has one (`docker compose down`), else by ending its processes. `scope: { section: <id> }` stops it when the run leaves that Section, which holds the node. Every step in its scope runs on its computer. A service on a fixed port goes after a Lease on that port. `secrets` as on a Command. Without a `failed` edge, a service that does not get ready fails the run.",
	"since-last-run":
		'Remembers what it saw, so a later run gets only what is new. `items` (list template) and `key` (path in each item; unset: the item), optional `compare` (the paths that count). Or `value` (template) and optional `when` (JSONata over `previous` and `current`). `scope` (template) splits the memory. `firstRun: "same"`: nothing is new on the first run. `data`: `new`, `changed`, `same_count`, `first_run`.',
	"web-request": `One HTTP request, with no shell. \`url\`, or \`urlSecret\`: a secret that holds the URL. \`method\` (default GET), \`query\`, \`headers\`, \`body\` (\`{ kind: "json", value }\`, \`text\` or \`form\`). \`\${NAME}\` in its own text reads a secret. \`pass\` on 2xx, else \`fail\`. It waits out 429 and 5xx. \`output\` types \`body\`.`,
	join: `Where parallel branches meet. \`wait\`: \`all\` (default), or \`first\` (stops the other branches). \`data\` holds each branch's \`data\` by the node it came from: \`{{reviewed.data.security}}\`.`,
	call: `Shown as Subflow. Runs another flow of the project (\`flow\`, its name), or a kit (\`kit:github/publish-draft-pr\`, see Kits), with \`inputs\` bound to templates. With \`each\`, it runs the flow once per element of a list: \`source\` is \`{ kind: "json", value }\` or \`{ kind: "command", command }\` (prints a JSON array); the element goes to the input named by \`as\`. A parameter sweep is one Command that loops, not one element per set. Without \`each\` its outputs are the called flow's outputs too. A called flow that ends at an End node ends the Subflow \`pass\` (\`done\`, \`nothing-to-do\`) or \`fail\` (\`failed\`); \`ended\` holds the End's status, \`end_message\` its message and \`end_report\` its report. With \`device\` (a computer's id, as \`list_profiles\` gives it), its steps run on that computer wherever the run runs.`,
	end: `Ends the run on purpose. \`status\`: ${endStatusSchema.options.map((status) => `\`${status}\``).join(", ")}. \`message\` (template) is one line for a person: the runs list and the notification show it. \`report: { kind: "text", text }\` (template, Markdown) is what the run produced, up to 64 KB: the run page, the flow's card and Home show it. \`report: { kind: "file", path }\` reads a text file the run wrote instead (\`path\`: template, relative to the folder the run works in). \`nothing-to-do\` is for a run that found no work: it is not a failure. \`failed\` fails the run on purpose. No edge leaves an End node.`,
	convert: `Converts \`value\` (a template) \`from\` a format \`to\` another, with no model: ${CONVERT_PAIRS.map((pair) => `\`${pair.from}\`→\`${pair.to}\``).join(", ")}. JSON comes out as \`data\`, text as \`text\`. A feed (RSS or Atom) gives \`{ title, link, items }\`, each item with ${FEED_ITEM_KEYS.map((key) => `\`${key}\``).join(", ")}.`,
};

const code = (names: readonly string[]) =>
	names.map((name) => `\`${name}\``).join(", ");

function nodeSection(type: FlowNodeType): string {
	const sample = parsed(sampleNodes[type]);
	const outcomes =
		type === "agent"
			? `${code(nodeOutcomes(sample))} unless it lists its own`
			: type === "command"
				? "its exits (`pass`, `fail` without `exits`)"
				: type === "decision"
					? "its options"
					: type === "call"
						? `${code(nodeOutcomes(parsed({ ...sampleNodes.call, each: undefined })))}; with \`each\`: ${code(nodeOutcomes(sample))}`
						: type === "end"
							? "none, the run ends here"
							: code(nodeOutcomes(sample));
	const fields =
		type === "call"
			? `${code(outputFieldsByType.call)}; with \`each\`: ${code(callEachOutputFields)}`
			: code(outputFieldsByType[type]);
	return [
		`### ${type}`,
		nodeText[type],
		`Outcomes: ${outcomes}. Outputs: ${fields}.`,
		`\`${JSON.stringify(sampleNodes[type])}\``,
	].join("\n\n");
}

/** The first example: build, test, fix at most three times, then ask. */
export const fixLoopExample: FlowInput = {
	version: FLOW_VERSION,
	description: "Builds a task, runs the tests, fixes failures, then asks.",
	inputs: [{ name: "task", type: "text", required: true }],
	outputs: [{ name: "summary", value: "{{vars.summary}}" }],
	variables: [
		{ name: "failures", type: "json", initial: "[]" },
		{ name: "summary", type: "text" },
	],
	start: "build",
	nodes: [
		{
			id: "build",
			type: "agent",
			position: { x: 0, y: 0 },
			profile: { device: EXAMPLE_DEVICE, profile: "worker" },
			prompt: "Implement {{task}}. Report what you changed.",
			set: [{ variable: "summary", value: "{{build.summary}}" }],
		},
		{
			id: "check",
			type: "command",
			position: { x: 300, y: 0 },
			command: "bun test",
			set: [
				{
					variable: "failures",
					on: ["fail"],
					expression: "$append(vars.failures, check.log_tail)",
				},
			],
		},
		{
			id: "fix",
			type: "agent",
			position: { x: 300, y: 200 },
			profile: { device: EXAMPLE_DEVICE, profile: "worker" },
			prompt:
				"The tests fail:\n{{check.log_tail}}\nEarlier failures: {{vars.failures}}\nFix the code, not the tests.",
			set: [{ variable: "summary", value: "{{fix.summary}}" }],
		},
		{
			id: "approve",
			type: "decision",
			position: { x: 600, y: 0 },
			by: "person",
			prompt: "The tests pass for {{task}}. Open a pull request?",
			options: [
				{ name: "open", description: "Open the pull request." },
				{ name: "stop", description: "Keep the branch, do nothing." },
			],
		},
		{
			id: "open_pr",
			type: "command",
			position: { x: 900, y: 0 },
			command: 'gh pr create --fill --body "{{vars.summary}}"',
		},
	],
	edges: [
		{ id: "build-pass-check", from: "build", outcome: "pass", to: "check" },
		{ id: "check-pass-approve", from: "check", outcome: "pass", to: "approve" },
		{ id: "check-fail-fix", from: "check", outcome: "fail", to: "fix", max: 3 },
		{ id: "fix-pass-check", from: "fix", outcome: "pass", to: "check" },
		{
			id: "approve-open-open_pr",
			from: "approve",
			outcome: "open",
			to: "open_pr",
		},
	],
};

/** The second example: find sources, then summarize each one in a subflow. */
export const findEachExample: FlowInput = {
	version: FLOW_VERSION,
	description: "Finds sources on a topic, then summarizes each one.",
	inputs: [{ name: "topic", type: "text", required: true }],
	outputs: [],
	start: "find",
	nodes: [
		{
			id: "find",
			type: "agent",
			position: { x: 0, y: 0 },
			profile: { device: EXAMPLE_DEVICE, profile: "researcher" },
			prompt: "Find recent sources on {{topic}}. Change no files.",
			outcomes: [
				{ name: "found", description: "The sources are ready." },
				{ name: "unclear", description: "The topic needs more detail." },
			],
			output: {
				type: "object",
				required: ["sources"],
				properties: {
					sources: {
						type: "array",
						items: {
							type: "object",
							required: ["id", "title", "url"],
							properties: {
								id: { type: "string" },
								title: { type: "string" },
								url: { type: "string" },
							},
						},
					},
				},
			},
		},
		{
			id: "read_all",
			type: "call",
			position: { x: 300, y: 0 },
			flow: "summarize-source",
			inputs: {},
			each: {
				source: { kind: "json", value: "{{find.data.sources}}" },
				as: "item",
			},
		},
		{
			id: "all_read",
			type: "decision",
			position: { x: 600, y: 0 },
			by: "rule",
			prompt: "Did every source finish?",
			options: [
				{ name: "clean", when: "read_all.failed_count = 0" },
				{ name: "failures" },
			],
		},
		{
			id: "report",
			type: "agent",
			position: { x: 900, y: 0 },
			profile: { device: EXAMPLE_DEVICE, profile: "researcher" },
			prompt:
				"These sources failed:\n{{read_all.summary}}\nWrite a short note on what is missing.",
		},
	],
	edges: [
		{
			id: "find-found-read_all",
			from: "find",
			outcome: "found",
			to: "read_all",
		},
		{
			id: "read_all-done-all_read",
			from: "read_all",
			outcome: "done",
			to: "all_read",
		},
		{
			id: "all_read-failures-report",
			from: "all_read",
			outcome: "failures",
			to: "report",
		},
	],
	sections: [
		{
			id: "work",
			label: "Read",
			color: "blue",
			nodes: ["read_all", "all_read"],
		},
	],
};

const types = Object.keys(outputFieldsByType) as FlowNodeType[];

/**
 * One kit in the guide, on one line: its name, its inputs (* required),
 * its outputs, and the first sentence of what it does.
 */
function kitLine({ name, flow }: Kit): string {
	const inputs = flow.inputs
		.map((input) => `${input.name}${input.required ? "*" : ""}`)
		.join(", ");
	const outputs = flow.outputs.map((output) => output.name).join(", ");
	const what = (flow.description ?? "").split(". ")[0]?.replace(/\.$/, "");
	return `- \`${name}\` (${inputs})${outputs ? ` → ${outputs}` : ""}: ${what}.`;
}

/**
 * The kits under their families, in the order of the add-node dialog: a
 * family heading, then its kits. A family without a kit is left out.
 */
function kitsByFamily(): string {
	const kits = kitList();
	return NODE_FAMILIES.flatMap((family) => {
		const lines = kits.filter((kit) => kit.family === family).map(kitLine);
		return lines.length > 0
			? [`${NODE_FAMILY_LABEL[family]}:\n\n${lines.join("\n")}`]
			: [];
	}).join("\n\n");
}

/** The guide, as Markdown. */
export function flowAuthoringGuide(): string {
	return `# Writing Night Shift flows

A flow is a directed graph of nodes and edges. Night Shift keeps it in the project, under its name. A run starts at \`start\`, runs one node (a step), and follows the edge for the outcome that step ended with. A run ends when no edge leaves on that outcome. A flow is a function: it takes \`inputs\` and returns \`outputs\`. Write version ${FLOW_VERSION}. The model never changes the graph at run time.

## The file

\`{ version: ${FLOW_VERSION}, description?, inputs, outputs, variables?, start, nodes, edges, sections?, policy? }\`

- \`inputs\`: \`{ name, type: "text" | "number" | "boolean" | "choice" | "json", label?, description?, default?, required?, options? }\`. The start dialog shows a field per type. \`choice\` needs \`options\` (a list of text) and gives the picked text. A default is text: \`"45"\`, \`"true"\`, one of the options, or JSON text. Use \`boolean\` for yes/no, \`number\` for counts and minutes, \`choice\` for a fixed list. A \`json\` input takes a path: \`{{item.title}}\`.
- \`outputs\`: \`{ name, value, description?, type?, schema? }\`. \`value\` is a template, rendered when the flow ends. \`type\` and \`schema\` as on a variable tell callers its shape.
- \`variables\`: \`{ name, type, initial?, schema?, description?, keep? }\`, \`type\` one of ${code(variableTypeSchema.options)}.
- \`policy\`: optional. \`maxSteps\` caps the steps of a run. \`budgetUsd\` stops the run when its known cost, at API prices, passes it. \`maxTurns\` and \`idleMinutes\` (default 15) limit each Agent step. A node may set its own. The stop time ends no running step. Only its own \`timeoutMinutes\` ends a long Command.
- \`sections\`: frames in the editor only, see below.

Names (node ids, inputs, variables): lowercase letters, digits and \`_\`, starting with a letter, at most 40 characters. Node ids and inputs share one namespace. Do not use ${code([...reservedNames, ...ruleOwnNames])}. Outcomes and option names: lowercase letters, digits and \`-\`. Do not use ${code(reservedOutcomes)}: those are the engine's.

## Nodes

The node types: ${code(types)}. Every node has \`id\`, \`type\`, \`position: { x, y }\`, and optional \`label\` (shown in the editor), \`timeoutMinutes\` and \`set\` (variable writes). Lay the nodes out left to right, about 300 apart on x, and put a loop's way back below the main line.

${types.map(nodeSection).join("\n\n")}

## Edges, outcomes and loops

An edge is \`{ id, from, outcome, to, max? }\`. It leaves \`from\` when its step ends with \`outcome\`. Each outcome a node can end with needs an edge, else the run ends there: on \`fail\` or \`needs-input\` that ends it as failed. To end the run on purpose, lead the edge to an End node: it says why the run ended (\`nothing-to-do\`, \`failed\`) in one line.

Every loop needs at least one edge with \`max\`: how often a run may take that edge. A Gate in a loop needs one too. Put \`max\` on the edge that goes back (\`check-fail-fix\`, max 3). When every edge for an outcome reached its max, the run fails there. Several edges with \`max\` may leave on one outcome: the run takes the first, in file order, that has not reached its max, and one last edge without \`max\` is the way on after them (fix three times, then ask a person). Every node must be reachable from \`start\`.

## Cascades

Climb from a cheap try to a strong one with a \`cascade\`, not with a loop of nodes. An Agent, a Decision or a Value by a model, and a Subflow (without \`each\`) take one: a list of tiers, cheap first. A try that does not hold tries again in its tier, up to \`tries\` (default 1), then the next tier. The cascade replaces the node's \`profile\`, \`decider\` and \`model\`. Every tier has an optional \`label\`.

- Agent tier: \`profile\` (or \`harness\`, \`model\`), \`session: "resume"\` to go on with the try before. The node's \`check\` (a command) runs after each try: a try holds when the agent ends \`pass\` and the check exits 0. The next try gets the failure in its prompt.
- Decision tier: \`profile\` and \`minConfidence\` (0 to 1). \`ollama\` and \`compatible\` give no probability: last model tier only.
- Value tier: \`profile\` and \`accept\`, JSONata over \`data\`.
- Subflow tier: \`flow\` and \`inputs\`.
- The last tier can be \`{ "person": true, "deadline"? }\`: a Gate. On a Value it is an Ask that starts with the best answer of the models; its deadline \`choose\` is \`accept\` (that answer) or \`fail\`. The person tier takes the brief fields too (see Briefs); without them the inbox shows what each tier picked, and recommends the surest pick.

\`{{cascade.tier}}\`, \`{{cascade.try}}\` and \`{{cascade.previous.summary}}\` read in the node's own templates. Later nodes read \`tier\` and \`tries\` (a Decision also \`confidence\`). A Decision with a cascade and no person tier can end \`fail\`.

## Asks

A Value with \`by: "person"\` is an Ask: a form in the Needs-you inbox, drawn from \`output\`. It takes a \`title\` too. A string is a text field, an \`enum\` a choice, an array of \`enum\` a choice of several, a boolean a switch, a number a number field. Each \`description\` is the hint under its field. The answer must match the schema, and it is the step's \`data\`. A Gate stays the router: put a Decision by a rule after an Ask to route on its data, or a Subflow with \`each\` to work on each chosen item.

- \`choices: { from, field }\`: \`from\` is a template that renders a list of \`{ name, label, description?, attachments? }\`, such as \`{{designer.data.variants}}\`. The names become the \`enum\` of the output field \`field\`: a string field is one choice, an array of strings a choice of several.
- \`attachments\`: \`[{ path | url, label? }]\`. A \`path\` is a file in the run's copy of the project: Night Shift keeps it with the run, so the web and the phone show it. A \`url\` is a link. A choice's \`attachments\` take the same shape.
- \`deadline: { at | minutes }\` and \`default\`: the data the Ask takes when nobody answers. The default must match the schema.

The phone answers a form of text, choices, switches and numbers. Any other field opens the form on the web.

## Briefs

A Gate, a person tier and an Ask take a brief. Every field is optional and takes templates. A model fills what you leave empty, unless \`fillBrief: false\`.

- \`urgency\`: \`now\` (work is blocked), \`today\` (the run waits) or \`later\`, or a template like \`{{triage.data.urgency}}\`. Set it on every Gate.
- \`situation\`: why a person must decide, one or two sentences.
- \`background\`: what is done or checked. A \`- \` line is one item. End one with \` (source: build)\`.
- \`recommend: { option, reason? }\` (a Decision only) and \`impact\` on each option: what picking it does. When an earlier step knows them, read it: \`{ option: "{{review.data.verdict}}" }\`.

## Parallel branches

Two or more edges without \`max\` on one outcome are a fan-out: each starts a branch, and all run at once. The branches share no node and all end at one \`join\` node, never at an \`end\`. No fan-out inside a branch: use a called flow. Branches share one copy of the project: give all but one \`permissionMode: "plan"\`. While one branch waits for a person or a Wait, the others pause.

## Templates

Prompts, commands, arguments, input bindings, outputs and variable values are templates: \`{{name}}\` or \`{{name.path}}\`.

- \`{{task}}\`: an input, by its name (a \`json\` input takes a path).
- \`{{check.log_tail}}\`: an output field of a node, by its id. A node that has not run yet gives "". \`data\` and \`results\` take a path: \`{{plan.data.tasks.0.title}}\`.
- \`{{vars.failures}}\`: a variable.
- \`{{run.branch}}\`: a field of the run: ${code(runFields)}.

A template that is only one reference keeps its JSON value (an array stays an array). The validator checks every reference: read only inputs, variables, run fields and output fields that exist. A path that an \`output\` schema lacks is a warning.

Rules (a Decision's \`when\`, a Value's \`expression\`, a write's \`expression\`) are JSONata over the same values, without braces: \`check.exit_code = 0 and vars.tries < 3\`.

## Variables

A variable is a named, typed value the flow keeps while it runs. Declare it in \`variables\`. \`initial\` is a template over the inputs and \`run\` only. Read it as \`{{vars.name}}\`. A node changes it with \`set\`, a list of \`{ variable, value | expression, on? }\`: exactly one of \`value\` (a template) or \`expression\` (JSONata), and \`on\` lists the outcomes that write (unset: every outcome). Writes apply in order when the step ends. The node's own id reads the step that just ended. Each flow, each Subflow and each element of a Subflow with \`each\` has its own variables. A value that does not fit the type ends the step with an error.

\`"keep": "project"\` keeps a variable between runs: memory for the next run, such as the issues a flow skipped. A run starts from the value the last write of this flow left in this project, else from \`initial\`. Each write saves it. A Subflow keeps its own, by its flow name. A kept value that no longer fits the type starts from \`initial\`. Check for duplicates with JSONata over the list: \`item.number in vars.skipped\`.

## Schedules and webhooks

A schedule starts a flow at set times (\`cron\`) or when a webhook arrives (\`webhook: { secret: "\${NAME}", when? }\`, \`when\` a JSONata rule over \`event\`). A webhook schedule's \`inputs\` are templates over the event: \`{{event.body.pull_request.number}}\`, \`{{event.headers.x-github-event}}\`. It can also send a signal to the project's runs (\`signal: { name, key? }\`, \`key\` JSONata over \`event\`): a Wait on that name wakes, with the event as its \`data\`. Wait for CI with a signal and a \`timeoutMinutes\`, or with \`any\` and a command as a backup, not with a command alone: the kits \`kit:github/wait-for-checks\` and \`kit:github/watch-pr\` do it.

A cron time missed while Night Shift was off still starts up to \`lateMinutes\` late (default 15, at most 10080): only the latest, once. Later, it is skipped with a notification. \`{{run.due_at}}\` and \`$NS_DUE_AT\` hold when the run was due (ISO 8601 UTC): use them, not the clock, for the day a run works on.

## Kits

A kit is a flow that ships with Night Shift: Commands on \`git\`, \`gh\`, \`acli\` or \`curl\`, or Web requests. A Subflow runs one by name (\`"flow": "kit:github/publish-draft-pr"\`) and reads its outputs (\`{{publish.url}}\`). Kits end at End nodes: \`ended\` and \`end_message\` say how. Prefer a kit to writing the same commands. Inputs with * are required. The \`kit:jira\` kits take that CLI tool as \`tool\`. \`kit:message/send\` posts to the URL in the secret that \`webhook\` names. \`kit:email/send\` reads the secrets \`EMAIL_SMTP_URL\`, \`EMAIL_SMTP_USER\` and \`EMAIL_SMTP_PASSWORD\`. The add-node dialog lists each kit under its family.

${kitsByFamily()}

A webhook schedule wakes \`wait-for-checks\` when CI is done: \`signal: { name: "ci-done", key: "event.body.check_suite.head_sha" }\`. It wakes \`watch-pr\` with \`signal: { name: "pr-changed", key: "event.body.pull_request.number" }\`.

## Profiles

An Agent Profile (the Agent fields \`harness\`, \`model\`, \`permissionMode\`, …) is for Agents, a Model Profile (\`decider\`, optional \`model\` and \`address\`) for a Decision or a Value by a model. \`openjev\` and \`compatible\` need a Model Profile with an address: a node never sets one. A profile belongs to one computer. A node names both by id, as \`list_profiles\` gives them: \`"profile": { "device": "<id>", "profile": "<id>" }\`. The step runs there, so the node has no \`device\`. The node's own fields win.

## Sections

\`{ id, label, color?, description?, nodes, sections? }\`: a box around nodes, for the editor only. \`sections\` lists the ids of the Sections inside it. A node is in one Section at most: the lowest one that holds it. A Section is inside one other at most. Colours: ${code(sectionColors)}. Outcome colours: ${code(outcomeColors)}.

Group a flow of more than about six nodes into Sections, one per phase of the work a person knows: "Pick the work", "Fix and check", "Review", "Ship". Put a node you add in the Section of its phase.

- All nodes of a Section, also those of the Sections inside, form one connected part. Every edge from outside goes to one node: its entry. A loop and its way back stay in one Section.
- A node that several Sections lead to, such as a shared End, stays outside them. Or give each Section its own End.
- Three to eight nodes per Section. Put Sections inside a Section only when it would hold more.
- \`label\`: two or three words. \`description\`: one sentence on what the phase does. Give Sections next to each other different colours.
- The box sits around its nodes' positions. Keep the nodes of a Section together, left to right, and the Sections one after the other, so the boxes do not overlap.
- \`check_flow\` warns when a Section breaks these rules: fix each warning.

## Checklist

- \`version\` is ${FLOW_VERSION}, \`start\` names a node, every edge connects known nodes on an outcome its source can end with.
- Every Agent node has a profile, or a harness, model and permission mode. Use only profiles, connections, CLI tools and flows that exist: look them up, do not invent names or ids.
- Every loop has an edge with \`max\`.
- A flow of more than about six nodes has Sections, one per phase, without warnings.
- Prefer a Command node to an Agent node when a shell command can do the job: it is fast, free and repeatable.
- Choices climb rule → model → person. Use a Decision by \`rule\` when a rule can decide, else by \`model\` with a person as the last cascade tier. Use a Gate only as a fallback (low confidence, the ladder ran out) or to approve an act that cannot be undone (send, publish, pay, merge).

## Example: build, test, fix, ask

\`\`\`json
${JSON.stringify(fixLoopExample, null, 1)}
\`\`\`

## Example: find sources, then summarize each

This one calls the flow \`summarize-source\`, which takes an input \`item\`.

\`\`\`json
${JSON.stringify(findEachExample, null, 1)}
\`\`\`
`;
}
