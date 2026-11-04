import type { ApiOutputs } from "@nightshift/client";
import type { Knowledge, KnowledgeFile } from "@/shared/api";

export type WaitingLearning = ApiOutputs["knowledge"]["learnings"][number];
export type AskedQuestion =
	ApiOutputs["knowledge"]["questions"]["asked"][number];
export type KnowledgeSync = Knowledge["syncs"][number];

/** One thing that waits for a person on the Knowledge page. */
export type ReviewTask =
	| { kind: "source"; id: string; sync: KnowledgeSync }
	| { kind: "learning"; id: string; learning: WaitingLearning }
	| { kind: "question"; id: string; question: AskedQuestion }
	| { kind: "unused"; id: string; files: KnowledgeFile[] };

export function learningTaskId(learningId: string): string {
	return `learning:${learningId}`;
}

/**
 * What waits, in the order a person meets it: what is broken first, then what
 * agents learned, then what could be better. The list of unused files has its
 * count in its id: when it grows, it asks again.
 */
export function reviewTasks(input: {
	syncs: readonly KnowledgeSync[];
	learnings: readonly WaitingLearning[];
	asked: readonly AskedQuestion[];
	unused: readonly KnowledgeFile[];
}): ReviewTask[] {
	const tasks: ReviewTask[] = [];
	for (const sync of input.syncs) {
		if (sync.health) {
			tasks.push({ kind: "source", id: `source:${sync.flow}`, sync });
		}
	}
	for (const learning of input.learnings) {
		tasks.push({
			kind: "learning",
			id: learningTaskId(learning.id),
			learning,
		});
	}
	for (const question of input.asked) {
		if (question.hits.length === 0) {
			tasks.push({
				kind: "question",
				id: `question:${question.query}`,
				question,
			});
		}
	}
	if (input.unused.length > 0) {
		tasks.push({
			kind: "unused",
			id: `unused:${input.unused.length}`,
			files: [...input.unused],
		});
	}
	return tasks;
}

/**
 * The tasks in the order they come up. Those gone leave. Those put off go to
 * the end, in the order they were put off. The one brought forward comes first.
 */
export function arrangeTasks(
	tasks: readonly ReviewTask[],
	state: {
		gone: ReadonlySet<string>;
		later: readonly string[];
		forward: string | null;
	},
): ReviewTask[] {
	const left = tasks.filter((task) => !state.gone.has(task.id));
	const waiting = [
		...left.filter((task) => !state.later.includes(task.id)),
		...state.later.flatMap((id) => left.filter((task) => task.id === id)),
	];
	return [
		...waiting.filter((task) => task.id === state.forward),
		...waiting.filter((task) => task.id !== state.forward),
	];
}

/** The node of the Map a task is about, if it has one. */
export function taskNode(task: ReviewTask): string | null {
	if (task.kind === "learning") return `learning:${task.learning.id}`;
	if (task.kind === "question") return `question:${task.question.query}`;
	return null;
}

/** A task in one line, for the list of what comes next. */
export function taskLine(task: ReviewTask): string {
	switch (task.kind) {
		case "source":
			return `${task.sync.flow} needs a look`;
		case "learning":
			return task.learning.notes[0] ?? "A learning";
		case "question":
			return `Agents found nothing for "${task.question.query}"`;
		case "unused":
			return `${task.files.length} ${task.files.length === 1 ? "file" : "files"} no run used`;
	}
}
