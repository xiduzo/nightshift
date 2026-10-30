/**
 * What the assistant's prompts share: the draft as JSON and in a few lines,
 * what a template in a node can read, who reads a node's data, the retry
 * after an invalid suggestion, and the prompts of a chat. The prompt of a
 * field suggestion, kind by kind, is in `suggestion-prompt.ts`.
 */
import {
	type Flow,
	type FlowNode,
	flowAuthoringGuide,
	type TemplateField,
	templateScope,
} from "@nightshift/flows";

/**
 * The flow as JSON for the agent. `canvas: false` leaves out what only the
 * canvas needs (positions, Sections): for a prompt about one field. A tool
 * that hands the agent a flow to change keeps them, else the agent's
 * proposal drops the person's Sections and layout.
 */
export function flowJson(
	flow: Flow | FlowNode,
	{ canvas = true }: { canvas?: boolean } = {},
): string {
	if (canvas) return JSON.stringify(flow, null, 2);
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
	/** The chat so far, with another agent: its messages and answers, oldest first. */
	history?: readonly ChatExchange[];
};

/** One message of the person in a chat, and the answer to it. */
export type ChatExchange = { message: string; answer: string };

/** The chat so far, for a new session that takes it over. */
function chatHistory(history: readonly ChatExchange[]): string[] {
	return [
		"# The chat so far",
		"",
		"The person chatted with another agent about this flow before. Continue that chat: this is what they said and what the agent answered, oldest first. The draft may have changed since: call `get_draft`.",
		"",
		...history.flatMap((exchange) => [
			"## The person",
			"",
			exchange.message,
			"",
			"## The agent",
			"",
			exchange.answer.trim() || "(No answer.)",
			"",
		]),
	];
}

function runTask(runId: string): string[] {
	return [
		`# This chat is about run ${runId}`,
		"",
		"The person asks about this run of the flow, often one that failed. Call `get_run` first. Then answer in three short parts:",
		"",
		"1. What happened: the step that failed, and what it was doing, in a sentence or two.",
		"2. Why: the cause, from its transcript. Quote one line of it only when that line says the cause.",
		"3. What to do. When a change to the flow would prevent it (a retry edge, a loop limit, a command that uses the wrong script, a prompt that lacks context), propose that change with `propose_flow`. When the cause is outside the flow (the code, a missing login, a full disk), say what the person can do. When the draft changed since the run and already fixes it, say so.",
		"",
		"Do not guess. When the transcript does not show the cause, say what you checked and what the person can look at.",
		"",
		"Cite each step you name with its link from `get_run`, copied as it is written there, such as [critic](#step-<step id>). The person sees it as the step and opens the step from it. Cite only the steps of this run, and never make a link up.",
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
		"1. Read before you write. Call `get_draft` for the flow as the person has it now: its nodes with their positions, and its Sections. Read the project in this folder when it helps (AGENTS.md, the README, the package scripts, CI config, skills). Read what you need, then answer.",
		"2. Look names up, do not invent them: `list_profiles`, `list_tools`, `list_skills`, `list_flows` and `get_flow`. A node names a profile with the `device` and `profile` ids that `list_profiles` gives. Reuse a flow with a Subflow (`call`) node instead of copying its steps.",
		"3. To change the flow, write the whole flow, not a patch: your proposal replaces the draft. Keep the ids, positions and Sections of what you do not change, so the person sees a small change. Place a new node next to the nodes it connects to, and move other nodes only to make room.",
		"4. Keep the flow tidy in Sections (see Sections in the guide below). Put a new node in the Section of its phase. When you build a flow, or the flow has more than about six nodes and no Sections, group the nodes into Sections and say so in one line.",
		"5. Call `check_flow`. Fix every error, and every warning about a Section. Then call `propose_flow` with the flow and a one- or two-sentence summary.",
		"6. After `propose_flow`, end your turn with a short message: what changed, and what the person must do next, such as save the flow, add a schedule or add a secret. Do not paste the flow's JSON in your answer.",
		"",
		"How to answer:",
		'- Short Markdown, in the language the person writes in. Address the person as "you". Lead with the result.',
		"- Use the words of the editor: flow, run, step, node, Gate, Section, schedule, profile, input, output, outcome. Leave out the internals of Night Shift: tools, JSON fields, file paths, positions.",
		"- Ask when the goal is not clear: what starts the flow, what it must make, and where a person must approve. Ask one or two questions at a time. When a sensible default exists, use it and say which one.",
		"- A question about the flow needs no proposal.",
		"",
		`# The flow "${input.flowName}"`,
		"",
		draftSummary(input.flow),
		"",
		...(input.runId ? runTask(input.runId) : []),
		...(input.history ? chatHistory(input.history) : []),
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
		"The person's next message. They may have changed or applied the draft since your last answer: call `get_draft` before you change the flow, and keep its positions and Sections.",
		"",
		...(input.newRunId ? runTask(input.newRunId) : []),
		input.message,
	].join("\n");
}
