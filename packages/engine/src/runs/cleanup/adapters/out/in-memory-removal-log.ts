import type { RemovalLog } from "../../application/ports";
import type { WorktreeRemoved } from "../../domain/safety";

/**
 * `RemovalLog` in memory: every removal in the order it was logged, with
 * the time of a clock the test sets (`at`).
 */
export function inMemoryRemovalLog() {
	const twin = {
		/** The time the next removal is logged at. */
		at: 1_000,
		/** Every removal, oldest first, as it was logged. */
		logged: [] as { at: number; removal: WorktreeRemoved }[],
		async removed(removal: WorktreeRemoved) {
			twin.logged.push({ at: twin.at, removal });
		},
		async removals(projectId: string) {
			return twin.logged
				.filter(({ removal }) => removal.projectId === projectId)
				.map(({ at, removal }) => ({
					at,
					runId: removal.runId,
					by: removal.by,
				}));
		},
	};
	return twin satisfies RemovalLog;
}

export type InMemoryRemovalLog = ReturnType<typeof inMemoryRemovalLog>;
