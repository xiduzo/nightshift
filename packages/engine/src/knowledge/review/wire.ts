import type { Database } from "@nightshift/db";
import { now as timeNow } from "@nightshift/time";
import type { Access } from "../../access";
import type { KnowledgeReader } from "../files";
import type { Learnings } from "../learnings";
import type { Sources } from "../sources";
import type { KnowledgeReconciler } from "../sync";
import { drizzleKnowledgeUseLog } from "./adapters/out/drizzle-knowledge-use-log";
import { fsQuestionSetFile } from "./adapters/out/fs-question-set-file";
import { listAskedQuestions } from "./application/list-asked-questions";
import { listQuestions } from "./application/list-questions";
import { listReviewTasks } from "./application/list-review-tasks";
import { markQuestion } from "./application/mark-question";
import { readKnowledgeUse } from "./application/read-knowledge-use";
import { readQuestionSet } from "./application/read-question-set";
import type { KnowledgeUseReport } from "./domain/use";

/**
 * The wiring of knowledge/review: the one place that builds its real adapters
 * and binds each use case to its ports.
 */

/** What the knowledge gives knowledge/review: the ports another part fills, and what the real adapters stand on. */
export type ReviewDeps = {
	access: Pick<Access, "openSpace">;
	/** The event log: the searches and reads of agents. */
	db: Database;
	/** The knowledge folders on this computer (`files`). */
	folders: {
		folder(projectId: string): string;
		ensure(projectId: string): Promise<string>;
	};
	holds: Pick<KnowledgeReconciler, "startStep">;
	files: Pick<KnowledgeReader, "files">;
	sources: Pick<Sources, "sourcesIn">;
	learnings: Pick<Learnings, "ofProjects">;
	/** The clock. Default `now`. */
	now?: () => number;
};

/** The review of the projects on this computer, bound to its ports. */
export type KnowledgeReview = {
	/** What waits for a person on the Knowledge page (`listReviewTasks`). */
	review: ReturnType<typeof listReviewTasks>;
	/** The questions agents asked, with the question set (`listQuestions`). */
	questions: ReturnType<typeof listQuestions>;
	/** Marks the files that answer a question (`markQuestion`). Returns the set. */
	markQuestion: ReturnType<typeof markQuestion>;
	/** How agents used each file (`readKnowledgeUse`). */
	use(projectId: string): Promise<KnowledgeUseReport>;
	/** The questions agents asked, newest first, at most 50 (`listAskedQuestions`). */
	asked: ReturnType<typeof listAskedQuestions>;
	/** The question set as the Space has it (`readQuestionSet`). */
	questionSet: ReturnType<typeof readQuestionSet>;
};

export function wireReview(deps: ReviewDeps): KnowledgeReview {
	const log = drizzleKnowledgeUseLog(deps.db);
	const questions = fsQuestionSetFile(deps.folders);
	const now = deps.now ?? timeNow;
	const asked = listAskedQuestions({ log });
	const use = readKnowledgeUse({ files: deps.files, log, now });
	const questionSet = readQuestionSet({ questions, holds: deps.holds });
	return {
		review: listReviewTasks({
			sources: deps.sources,
			learnings: deps.learnings,
			asked,
			use,
		}),
		questions: listQuestions({ asked, questionSet }),
		markQuestion: markQuestion({
			access: deps.access,
			questions,
			holds: deps.holds,
			now,
		}),
		use: async (projectId) => (await use({ projectId })).use,
		asked,
		questionSet,
	};
}
