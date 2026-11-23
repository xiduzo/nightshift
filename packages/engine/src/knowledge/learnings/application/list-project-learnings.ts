import type { ProjectLearning, WaitingLearning } from "../domain/waiting";
import type { ListWaitingLearnings } from "./list-waiting-learnings";

export type ListProjectLearningsPorts = {
	/** `listWaitingLearnings`, bound by the wire. */
	waiting(request: ListWaitingLearnings): Promise<WaitingLearning[]>;
};

/** The projects whose learnings to list. */
export type ListProjectLearnings = { projectIds: readonly string[] };

/**
 * The learnings that wait for a person in these projects, each with its
 * project: newest first, and by id for a tie. The projects are read at
 * once.
 *
 * It checks no role: the `Knowledge` door has no actor yet (E-doors adds it).
 */
export const listProjectLearnings =
	(ports: ListProjectLearningsPorts) =>
	async ({ projectIds }: ListProjectLearnings): Promise<ProjectLearning[]> => {
		const lists = await Promise.all(
			projectIds.map(async (projectId) =>
				(await ports.waiting({ projectId })).map((learning) => ({
					...learning,
					projectId,
				})),
			),
		);
		return lists
			.flat()
			.sort((a, b) => b.proposedAt - a.proposedAt || a.id.localeCompare(b.id));
	};
