import type { ApiOutputs } from "../api";

/** One thing that waits for a person on the Knowledge page, as the engine decides it. */
export type ReviewTask = ApiOutputs["knowledge"]["review"][number];

/**
 * The tasks in the order they come up. Those gone leave. Those put off go to
 * the end, in the order they were put off. The one brought forward comes first.
 */
export function arrangeTasks<T extends { id: string }>(
	tasks: readonly T[],
	state: {
		gone: ReadonlySet<string>;
		later: readonly string[];
		forward: string | null;
	},
): T[] {
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

/** A task in one line, for the list of what comes next. */
export function taskLine(task: ReviewTask): string {
	switch (task.kind) {
		case "source":
			return `Check ${task.sync.flow}`;
		case "learning":
			return task.learning.notes[0] ?? "A learning";
		case "question":
			return `Agents found nothing for "${task.question.query}"`;
		case "unused":
			return `${task.files.length} ${task.files.length === 1 ? "file" : "files"} that no run used`;
	}
}
