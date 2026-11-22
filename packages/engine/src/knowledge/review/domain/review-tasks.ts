import type { AskedQuestion } from "./use";

/**
 * What waits for a person on a project's Knowledge page, and in what order:
 * one rule, so no screen decides it again. A task's `id` stays the same for
 * as long as it asks the same thing, so a screen can remember what a person
 * put off or dismissed.
 *
 * The rule reads a source's flow and health, a learning's id and the files
 * no run used: their full shapes belong to `sources`, `learnings` and
 * `files`, so the rule takes them as they come (G1).
 */

/** One thing that waits for a person. `node`: the node of the Map it is about, if it has one. */
export type ReviewTaskOf<Sync, Learning, File> =
	| { kind: "source"; id: string; node: null; sync: Sync }
	| { kind: "learning"; id: string; node: string; learning: Learning }
	| { kind: "question"; id: string; node: string; question: AskedQuestion }
	| { kind: "unused"; id: string; node: null; files: File[] };

/** The nodes of the Map a task points at (`learningNode` and `questionNode` of `map`). */
export type MapNodes = {
	learning(id: string): string;
	question(query: string): string;
};

/**
 * What waits, in the order a person meets it: what is broken first, then what
 * agents learned, then what could be better. The list of unused files has its
 * count in its id: when it grows, it asks again.
 */
export function reviewTasks<
	Sync extends { flow: string; health: string | null },
	Learning extends { id: string },
	File,
>(
	input: {
		syncs: readonly Sync[];
		learnings: readonly Learning[];
		asked: readonly AskedQuestion[];
		unused: readonly File[];
	},
	nodes: MapNodes,
): ReviewTaskOf<Sync, Learning, File>[] {
	const tasks: ReviewTaskOf<Sync, Learning, File>[] = [];
	for (const sync of input.syncs) {
		if (sync.health) {
			tasks.push({
				kind: "source",
				id: `source:${sync.flow}`,
				node: null,
				sync,
			});
		}
	}
	for (const learning of input.learnings) {
		tasks.push({
			kind: "learning",
			id: `learning:${learning.id}`,
			node: nodes.learning(learning.id),
			learning,
		});
	}
	for (const question of input.asked) {
		if (question.hits.length === 0) {
			tasks.push({
				kind: "question",
				id: `question:${question.query}`,
				node: nodes.question(question.query),
				question,
			});
		}
	}
	if (input.unused.length > 0) {
		tasks.push({
			kind: "unused",
			id: `unused:${input.unused.length}`,
			node: null,
			files: [...input.unused],
		});
	}
	return tasks;
}
