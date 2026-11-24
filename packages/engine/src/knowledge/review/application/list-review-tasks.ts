import type { KnowledgeFile } from "../../files";
import type { Learnings, ProjectLearning } from "../../learnings";
import { learningNode, questionNode } from "../../map";
import type { KnowledgeSync, Sources, SourcesSpace } from "../../sources";
import { type ReviewTaskOf, reviewTasks } from "../domain/review-tasks";
import type { listAskedQuestions } from "./list-asked-questions";
import type { readKnowledgeUse } from "./read-knowledge-use";

export type ListReviewTasksPorts = {
	sources: Pick<Sources, "sourcesIn">;
	learnings: Pick<Learnings, "ofProjects">;
	/** `listAskedQuestions`, bound by the wire. */
	asked: ReturnType<typeof listAskedQuestions>;
	/** `readKnowledgeUse`, bound by the wire. */
	use: ReturnType<typeof readKnowledgeUse>;
};

/** Which project, in the Space as the person who asks sees it. */
export type ListReviewTasks = { projectId: string; space: SourcesSpace };

/** One thing that waits for a person on the Knowledge page. */
export type ReviewTask = ReviewTaskOf<
	KnowledgeSync,
	ProjectLearning,
	KnowledgeFile
>;

/**
 * What waits for a person on the Knowledge page, in the order a person
 * meets it: sources that need a look, learnings, questions that found
 * nothing and files no run used. The four reads start at once. It holds
 * no folder. Only a learning whose content is not here yet asks the Host.
 *
 * It checks no role: the `Knowledge` door has no actor yet (E-doors adds it).
 */
export const listReviewTasks =
	(ports: ListReviewTasksPorts) =>
	async ({ projectId, space }: ListReviewTasks): Promise<ReviewTask[]> => {
		const [syncs, waiting, asked, used] = await Promise.all([
			ports.sources.sourcesIn(space).syncs(projectId),
			ports.learnings.ofProjects({ projectIds: [projectId] }),
			ports.asked({ projectId }),
			ports.use({ projectId }),
		]);
		const unused = new Set(used.use.unused);
		return reviewTasks(
			{
				syncs,
				learnings: waiting,
				asked,
				unused: used.files.filter((file) => unused.has(file.path)),
			},
			{ learning: learningNode, question: questionNode },
		);
	};
