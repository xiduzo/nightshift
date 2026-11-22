import type { KnowledgeUseLog } from "../../application/ports";
import type { KnowledgeUseRow } from "../../domain/use";

/**
 * `KnowledgeUseLog` in memory. A test logs a use (`log`) where the real
 * adapter would find it in the event log.
 */
export function inMemoryKnowledgeUseLog() {
	const logged: { projectId: string; row: KnowledgeUseRow }[] = [];
	const twin = {
		/** Each read asked of the log, in order. */
		reads: [] as { projectId: string; limit: number; since?: number }[],
		/** Logs a use of a project's knowledge, after the ones before. */
		log(projectId: string, row: KnowledgeUseRow) {
			logged.push({ projectId, row });
		},
		async events(
			projectId: string,
			types: readonly KnowledgeUseRow["type"][],
			options: { limit: number; since?: number },
		) {
			twin.reads.push({ projectId, ...options });
			const { since } = options;
			return logged
				.filter(
					(use) =>
						use.projectId === projectId &&
						types.includes(use.row.type) &&
						(since === undefined || use.row.at >= since),
				)
				.map((use) => use.row)
				.reverse()
				.slice(0, options.limit);
		},
	};
	return twin satisfies KnowledgeUseLog;
}

export type InMemoryKnowledgeUseLog = ReturnType<
	typeof inMemoryKnowledgeUseLog
>;
