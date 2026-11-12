import type { RunDetail, StepSummary, TranscriptEntry } from "./types";

/**
 * Where one step is: running, waiting for a person at its Gate, failed,
 * stopped (by a person, or when Night Shift stopped), or done (with the
 * outcome it ended on).
 */
export type StepState = "running" | "waiting" | "failed" | "stopped" | "done";

/** The outcomes of a step that did not finish its work. */
const STOPPED_OUTCOMES = new Set(["stopped", "interrupted"]);

export function stepState(
	step: Pick<StepSummary, "endedAt" | "error" | "gate" | "outcome">,
): StepState {
	if (step.endedAt === null) return step.gate ? "waiting" : "running";
	if (step.error !== null) return "failed";
	return step.outcome !== null && STOPPED_OUTCOMES.has(step.outcome)
		? "stopped"
		: "done";
}

/**
 * The steps that run now, the first started first. Parallel branches run
 * several at once; a run without branches has one at most. A step inside a
 * called flow runs with the step that called it: pass the run's own steps
 * to leave it out.
 */
export function runningSteps<
	T extends Pick<StepSummary, "startedAt" | "endedAt">,
>(steps: readonly T[]): T[] {
	return steps
		.filter((step) => step.endedAt === null)
		.sort((a, b) => a.startedAt - b.startedAt);
}

/** The name of each node of a run, by id: its label, else its id. The run's own flow wins over the flows it calls. */
export function nodeLabels(
	run: Pick<RunDetail, "flow" | "calledFlows">,
): Map<string, string> {
	const labels = new Map<string, string>();
	for (const flow of [...Object.values(run.calledFlows), run.flow]) {
		for (const node of flow.nodes) labels.set(node.id, node.label || node.id);
	}
	return labels;
}

/** A step by its node's name, with the visit when the run came back to it: "Review (visit 2)". */
export function stepName(
	step: Pick<StepSummary, "nodeId" | "visit">,
	labels: ReadonlyMap<string, string>,
): string {
	const name = labels.get(step.nodeId) ?? step.nodeId;
	return step.visit > 1 ? `${name} (visit ${step.visit})` : name;
}

/**
 * How far a run is through its flow: `at` is how many of the flow's nodes
 * have started (a node the run came back to counts once), `of` is how many
 * nodes the flow has. Only the run's own steps count, not those of a flow
 * it calls. A branch the run does not take leaves `at` below `of`.
 */
export function stepPosition(
	steps: readonly Pick<StepSummary, "nodeId" | "scope">[],
	flow: Pick<RunDetail["flow"], "nodes">,
): { at: number; of: number } {
	const nodes = new Set(flow.nodes.map((node) => node.id));
	const started = new Set<string>();
	for (const step of steps) {
		if (step.scope === null && nodes.has(step.nodeId)) started.add(step.nodeId);
	}
	return { at: started.size, of: nodes.size };
}

/** The latest message of an agent in one step, as it streams in. */
export type AgentMessage = { id: string; text: string };

/** The latest agent message per step id. */
export type AgentMessages = ReadonlyMap<string, AgentMessage>;

/**
 * Lays transcript entries over the latest agent message of each step. A
 * text delta of the same message adds to it; a new message or an agent's
 * report takes its place. Returns the same map when nothing changed.
 */
export function applyAgentMessages(
	messages: AgentMessages,
	entries: readonly TranscriptEntry[],
): AgentMessages {
	let next: Map<string, AgentMessage> | null = null;
	const read = (stepId: string) => (next ?? messages).get(stepId);
	const write = (stepId: string, message: AgentMessage) => {
		next ??= new Map(messages);
		next.set(stepId, message);
	};
	for (const { stepId, seq, event } of entries) {
		// A subagent's text is not the step's message.
		if (event.type === "text" && !event.parentToolCallId) {
			const known = read(stepId);
			write(
				stepId,
				known && known.id === event.messageId
					? { id: known.id, text: known.text + event.delta }
					: { id: event.messageId, text: event.delta },
			);
		} else if (event.type === "report" && event.summary.trim() !== "") {
			write(stepId, { id: `report:${seq}`, text: event.summary });
		}
	}
	return next ?? messages;
}

/**
 * A short plain-text preview of Markdown: no heading marks, emphasis,
 * code fences or link targets, list items as bullets, at most `max`
 * characters. For a place too small to render the Markdown itself.
 */
export function markdownPreview(markdown: string, max = 280): string {
	const lines = markdown
		.replace(/\r\n?/g, "\n")
		.split("\n")
		.filter((line) => !/^\s*(```|~~~)/.test(line))
		.map((line) =>
			line
				.replace(/^\s{0,3}#{1,6}\s+/, "")
				.replace(/^\s*>\s?/, "")
				.replace(/^\s*[-*+]\s+(\[[ xX]\]\s+)?/, "• ")
				.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
				.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
				.replace(/(\*\*|__)(.+?)\1/g, "$2")
				.replace(/(^|[^\w*])[*_]([^*_\s][^*_]*?)[*_](?=[^\w*]|$)/g, "$1$2")
				.replace(/`([^`]*)`/g, "$1")
				.trimEnd(),
		);
	const text = lines
		.join("\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
	return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}
