/**
 * The prompts of a field suggestion: what the agent knows (the guide to
 * flows, the draft, the node, what a template there can read, who reads the
 * node's data), what it must do for each kind, and the retry after an
 * invalid answer.
 */
import {
	type Flow,
	type FlowNode,
	flowAuthoringGuide,
	nodeOutcomes,
	type SuggestionKind,
	type SuggestionRequest,
	type TemplateField,
	templateScope,
} from "@nightshift/flows";

/** The flow as JSON for the agent, without what only the canvas needs. */
export function flowJson(flow: Flow | FlowNode): string {
	return JSON.stringify(
		flow,
		(key, value) =>
			key === "position" || key === "sections" ? undefined : value,
		2,
	);
}

function fieldLine(field: TemplateField): string {
	const notes = [
		field.json ? "JSON: a path below it works" : "",
		field.description ?? "",
	].filter(Boolean);
	return `- \`{{${field.ref}}}\`${notes.length > 0 ? `: ${notes.join(". ")}` : ""}`;
}

/** Every reference a template in this flow may use, as a Markdown list. */
export function scopeList(flow: Flow, nodeId: string): string {
	const scope = templateScope(flow);
	const lines: string[] = [];
	lines.push("Flow inputs:");
	lines.push(
		...(scope.inputs.length > 0
			? scope.inputs.map(fieldLine)
			: ["- none: the flow has no inputs"]),
	);
	lines.push("", "Flow variables:");
	lines.push(
		...((scope.vars ?? []).length > 0
			? (scope.vars ?? []).map(fieldLine)
			: ["- none: the flow declares no variables"]),
	);
	lines.push("", "Outputs of the nodes (the latest step of each):");
	for (const node of scope.nodes) {
		const own =
			node.id === nodeId ? " (this node: its previous step, in a loop)" : "";
		lines.push(`- Node \`${node.id}\`${own}:`);
		for (const field of node.fields) {
			lines.push(`  ${fieldLine(field)}`);
			for (const key of field.keys ?? []) lines.push(`    ${fieldLine(key)}`);
		}
		if (node.open)
			lines.push("    - more fields: the outputs of the flow it calls");
	}
	lines.push("", "The run:", ...scope.run.map(fieldLine));
	return lines.join("\n");
}

const escapeRegExp = (text: string) =>
	text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The keys of `nodeId`'s `data` that the rest of the flow reads: in
 * templates (`{{plan.data.tasks}}`), rules and expressions (`plan.data.ok`),
 * and the flow's outputs. Each key with who reads it.
 */
export function dataReaders(
	flow: Flow,
	nodeId: string,
): { key: string; readers: string[] }[] {
	const pattern = new RegExp(
		`(?<![A-Za-z0-9_.])${escapeRegExp(nodeId)}\\.data\\.([A-Za-z0-9_-]+)`,
		"g",
	);
	const found = new Map<string, Set<string>>();
	const scan = (text: string, reader: string) => {
		for (const match of text.matchAll(pattern)) {
			const key = match[1] as string;
			const readers = found.get(key) ?? new Set<string>();
			readers.add(reader);
			found.set(key, readers);
		}
	};
	for (const node of flow.nodes) {
		if (node.id === nodeId) continue;
		scan(JSON.stringify(node), `node \`${node.id}\``);
	}
	scan(JSON.stringify(flow.outputs), "the flow's outputs");
	scan(JSON.stringify(flow.variables ?? []), "the flow's variables");
	// Its own writes read its data too.
	const self = flow.nodes.find((node) => node.id === nodeId);
	if (self?.set) scan(JSON.stringify(self.set), `this node's variable writes`);
	return [...found].map(([key, readers]) => ({ key, readers: [...readers] }));
}

const SELECTION_START = "⟦SELECTION⟧";
const SELECTION_END = "⟦/SELECTION⟧";

function promptTask(request: SuggestionRequest, node: FlowNode): string[] {
	const current = (node as { prompt?: string }).prompt ?? "";
	const what =
		node.type === "decision"
			? "the question a model reads to pick one of the node's options"
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
			`- Say when to end with each outcome: ${node.outcomes.map((o) => `\`${o.name}\``).join(", ")}.`,
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
}

function outputTask(flow: Flow, node: FlowNode): string[] {
	const readers = dataReaders(flow, node.id);
	const current = (node as { output?: unknown }).output;
	const lines = [
		`Write the node's output schema: a JSON Schema for an object (\`"type": "object"\`, \`properties\`, \`required\`). The step's \`data\` must match it, and the rest of the flow reads it as \`{{${node.id}.data.<field>}}\`.`,
		"",
		"Rules:",
		"- Keep the fields the rest of the flow reads (below), with a type that fits how they are read.",
		"- Add the fields the node's prompt asks the agent to report.",
		"- Give each property a short `description`. Prefer simple types: string, number, boolean, arrays and objects of those.",
		"- Keep it small: only fields someone reads or the person asked for.",
		"",
	];
	lines.push(
		readers.length > 0
			? [
					"What the rest of the flow reads from this node's data:",
					...readers.map(
						(r) => `- \`${r.key}\`: read by ${r.readers.join(", ")}`,
					),
				].join("\n")
			: "No other node reads this node's data yet.",
	);
	lines.push(
		"",
		current
			? [
					"The current output schema:",
					"```json",
					JSON.stringify(current, null, 2),
					"```",
				].join("\n")
			: "The node has no output schema yet.",
	);
	return lines;
}

function setTask(flow: Flow, node: FlowNode): string[] {
	return [
		"Write the node's variable writes (`set`): what this step stores in the flow's variables when it ends, so later steps can read it as `{{vars.<name>}}`.",
		"",
		"Each write: `{ variable, value?, expression?, on? }`, with exactly one of `value` and `expression`:",
		"- `value`: a template, for example `{{" +
			node.id +
			".summary}}`. One reference alone keeps its JSON value.",
		"- `expression`: a JSONata expression over the run's values, `vars` included, for example `vars.tries + 1`.",
		`- \`on\`: the outcomes that write, from ${nodeOutcomes(node)
			.map((o) => `\`${o}\``)
			.join(", ")}. Leave it out to write on every outcome.`,
		"",
		"Rules:",
		"- `set` replaces the node's writes: keep the current ones that still make sense.",
		"- Use only references listed above.",
		'- Put each variable a write needs that the flow does not declare yet in `variables`: `{ name, type: "text" | "number" | "boolean" | "json", description?, initial? }`. Leave out the ones the flow declares.',
		"",
		node.set && node.set.length > 0
			? [
					"The current writes:",
					"```json",
					JSON.stringify(node.set, null, 2),
					"```",
				].join("\n")
			: "The node writes no variables yet.",
		"",
		(flow.variables ?? []).length > 0
			? [
					"The flow's variables:",
					"```json",
					JSON.stringify(flow.variables, null, 2),
					"```",
				].join("\n")
			: "The flow declares no variables yet.",
	];
}

const KIND_TASK: Record<SuggestionKind, string> = {
	prompt: "a prompt",
	output: "an output schema",
	set: "variable writes",
};

/** The prompt of one suggestion. */
export function suggestionPrompt(request: SuggestionRequest): string {
	const { flow, nodeId, kind } = request;
	const node = flow.nodes.find((candidate) => candidate.id === nodeId);
	if (!node) throw new Error(`The flow has no node "${nodeId}".`);
	const task =
		kind === "prompt"
			? promptTask(request, node)
			: kind === "output"
				? outputTask(flow, node)
				: setTask(flow, node);
	const instruction = request.instruction.trim();
	return [
		`You help a person build a Night Shift flow in its editor. Suggest ${KIND_TASK[kind]} for one node. You only suggest: never change a file. The person sees your suggestion and applies it or not.`,
		"",
		"Read the project in this folder when it helps you ground the answer: AGENTS.md or CLAUDE.md, the README, the package scripts, the skills (`.claude/skills`, `.agents/skills`), and the code the node works on. Read what you need, then answer. Do not explore further.",
		"",
		`# The flow "${request.flowName}" (the person's draft)`,
		"",
		"```json",
		flowJson(flow),
		"```",
		"",
		`# The node \`${node.id}\` (${node.type})`,
		"",
		"```json",
		flowJson(node),
		"```",
		"",
		"# What a template in this node can read",
		"",
		scopeList(flow, nodeId),
		"",
		"# Your task",
		"",
		...task,
		"",
		"# The person's instruction",
		"",
		instruction === ""
			? "None. Make the suggestion that fits this node best."
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

/** The follow-up when the answer does not pass the checks. */
export function retryPrompt(problems: readonly string[]): string {
	return [
		"Your suggestion does not pass the checks:",
		...problems.map((problem) => `- ${problem}`),
		"",
		"Fix these problems and report the whole suggestion again.",
	].join("\n");
}

/** The draft in a few lines: its steps, inputs and outputs. */
export function draftSummary(flow: Flow): string {
	const lines = [
		flow.description ? `Description: ${flow.description}` : "",
		flow.nodes.length > 0
			? `Steps: ${flow.nodes.map((node) => `\`${node.id}\` (${node.type})`).join(", ")}. Starts at \`${flow.start}\`.`
			: "No steps yet: the flow is empty.",
		flow.inputs.length > 0
			? `Inputs: ${flow.inputs.map((input) => `\`${input.name}\``).join(", ")}.`
			: "",
		flow.outputs.length > 0
			? `Outputs: ${flow.outputs.map((output) => `\`${output.name}\``).join(", ")}.`
			: "",
	];
	return lines.filter(Boolean).join("\n");
}

/** What the first message of a chat needs. */
export type ChatPromptInput = {
	flowName: string;
	flow: Flow;
	message: string;
	/** The chat is about this run of the flow. */
	runId?: string;
};

function runTask(runId: string): string[] {
	return [
		`# This chat is about run ${runId}`,
		"",
		"The person asks about this run of the flow, often one that failed. Call `get_run` first. Then explain in plain words what went wrong and why, in a few sentences. When a change to the flow would prevent it (a retry edge, a loop limit, a command that uses the wrong script, a prompt that lacks context), propose that change with `propose_flow`. When the cause is outside the flow (the code, a missing login), say what the person can do.",
		"",
	];
}

/** The first message of a chat: the role, the rules, the flow, then the person's message. */
export function chatPrompt(input: ChatPromptInput): string {
	return [
		"You help a person build a Night Shift flow in its editor, in a chat beside the canvas. You only read and propose: never change a file. The person sees your proposal on the canvas and applies it or not, then saves.",
		"",
		"# How to work",
		"",
		"1. Read before you write. Call `get_draft` for the flow as the person has it now. Read the project in this folder when it helps (AGENTS.md, the README, the package scripts, CI config, skills). Read what you need, then answer.",
		"2. Look names up, do not invent them: `list_profiles`, `list_tools`, `list_skills`, `list_flows` and `get_flow`. Reuse a flow with a Subflow (`call`) node instead of copying its steps.",
		"3. To change the flow, write the whole flow, not a patch. Keep the ids and positions of the nodes and edges you do not change, so the person sees a small change.",
		"4. Call `check_flow` and fix every error. Then call `propose_flow` with the flow and a one- or two-sentence summary.",
		"5. After `propose_flow`, end your turn with a short message. Do not paste the flow's JSON in your answer.",
		"",
		"Answer in short Markdown, to the person: plain words, no internals of Night Shift. Ask when the goal is not clear: what starts the flow, what it must make, and where a person must approve. A question about the flow needs no proposal.",
		"",
		`# The flow "${input.flowName}"`,
		"",
		draftSummary(input.flow),
		"",
		...(input.runId ? runTask(input.runId) : []),
		"# The person's message",
		"",
		input.message,
		"",
		"---",
		"",
		"For reference, how Night Shift flows work:",
		"",
		flowAuthoringGuide(),
	].join("\n");
}

/** A later message in the same chat. The draft may have changed since. */
export function chatFollowUpPrompt(input: {
	message: string;
	/** A run this chat was not about before. */
	newRunId?: string;
}): string {
	return [
		"The person's next message. They may have changed or applied the draft since your last answer: call `get_draft` before you change the flow.",
		"",
		...(input.newRunId ? runTask(input.newRunId) : []),
		input.message,
	].join("\n");
}
