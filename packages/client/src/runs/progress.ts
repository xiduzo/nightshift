import type {
	RunStatus,
	RunSummary,
	StepSummary,
	TranscriptEntry,
} from "./types";

/**
 * Where a run is, for a list of runs: on its way (running or sleeping),
 * waiting for a person at a Gate, or ended.
 */
export type RunGroup = "running" | "waiting" | "ended";

const GROUP_OF: Record<RunStatus, RunGroup> = {
	running: "running",
	sleeping: "running",
	waiting: "waiting",
	finished: "ended",
	failed: "ended",
	stopped: "ended",
	interrupted: "ended",
};

/** The group of a run's status. */
export function runGroup(status: RunStatus): RunGroup {
	return GROUP_OF[status];
}

/** Whether a run with this status has ended: nothing runs and nothing waits. */
export function hasEnded(status: RunStatus): boolean {
	return GROUP_OF[status] === "ended";
}

/**
 * The runs by group, in the order a person reads them: what runs, what
 * waits for you, what ended. Newest first in each group. A group without
 * runs is left out.
 */
export function groupRuns<T extends Pick<RunSummary, "status" | "createdAt">>(
	runs: readonly T[],
): { group: RunGroup; runs: T[] }[] {
	const order: RunGroup[] = ["running", "waiting", "ended"];
	const byGroup = new Map<RunGroup, T[]>(order.map((group) => [group, []]));
	for (const run of runs) byGroup.get(runGroup(run.status))?.push(run);
	return order
		.map((group) => ({
			group,
			runs: (byGroup.get(group) ?? []).sort(
				(a, b) => b.createdAt - a.createdAt,
			),
		}))
		.filter((entry) => entry.runs.length > 0);
}

/**
 * Where one step is: running, waiting for a person at its Gate, failed,
 * or done (with the outcome it ended on).
 */
export type StepState = "running" | "waiting" | "failed" | "done";

export function stepState(
	step: Pick<StepSummary, "endedAt" | "error" | "gate">,
): StepState {
	if (step.endedAt === null) return step.gate ? "waiting" : "running";
	return step.error !== null ? "failed" : "done";
}

/** The step that runs now: the last one that started and has not ended. */
export function currentStep<
	T extends Pick<StepSummary, "startedAt" | "endedAt">,
>(steps: readonly T[]): T | null {
	let current: T | null = null;
	for (const step of steps) {
		if (step.endedAt !== null) continue;
		if (!current || step.startedAt >= current.startedAt) current = step;
	}
	return current;
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
		if (event.type === "text") {
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
