import type { KnowledgeFile } from "./folder-snapshot";
import type { ProjectLearning } from "./learnings";
import { learningNode, questionNode } from "./map";
import type { KnowledgeSync } from "./sources";
import type { AskedQuestion } from "./use";

/**
 * What waits for a person on a project's Knowledge page, and in what order:
 * one rule, so no screen decides it again. A task's `id` stays the same for
 * as long as it asks the same thing, so a screen can remember what a person
 * put off or dismissed.
 */

/** One thing that waits for a person. `node`: the node of the Map it is about, if it has one. */
export type ReviewTask =
	| { kind: "source"; id: string; node: null; sync: KnowledgeSync }
	| { kind: "learning"; id: string; node: string; learning: ProjectLearning }
	| { kind: "question"; id: string; node: string; question: AskedQuestion }
	| { kind: "unused"; id: string; node: null; files: KnowledgeFile[] };

/**
 * What waits, in the order a person meets it: what is broken first, then what
 * agents learned, then what could be better. The list of unused files has its
 * count in its id: when it grows, it asks again.
 */
export function reviewTasks(input: {
	syncs: readonly KnowledgeSync[];
	learnings: readonly ProjectLearning[];
	asked: readonly AskedQuestion[];
	unused: readonly KnowledgeFile[];
}): ReviewTask[] {
	const tasks: ReviewTask[] = [];
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
			node: learningNode(learning.id),
			learning,
		});
	}
	for (const question of input.asked) {
		if (question.hits.length === 0) {
			tasks.push({
				kind: "question",
				id: `question:${question.query}`,
				node: questionNode(question.query),
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
