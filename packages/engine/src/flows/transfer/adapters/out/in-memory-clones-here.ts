import type { ClonesHere } from "../../application/ports";
import type { CloneHere } from "../../domain/clone-import";

/** The Clones of a test, in the order they were added, each of a Device. */
export type InMemoryClonesHere = ClonesHere & {
	add(deviceId: string, clone: CloneHere): void;
	/** The Project is removed: its Clones are no longer listed. */
	removeProject(projectId: string): void;
	/** From now on `list` throws this. */
	fail(error: unknown): void;
};

export function inMemoryClonesHere(): InMemoryClonesHere {
	const rows: { deviceId: string; clone: CloneHere }[] = [];
	const removed = new Set<string>();
	let failure: { error: unknown } | null = null;
	return {
		add(deviceId, clone) {
			rows.push({ deviceId, clone });
		},
		removeProject(projectId) {
			removed.add(projectId);
		},
		fail(error) {
			failure = { error };
		},
		async list(deviceId, projectId) {
			if (failure) throw failure.error;
			return rows
				.filter(
					(row) =>
						row.deviceId === deviceId &&
						!removed.has(row.clone.projectId) &&
						(projectId === undefined || row.clone.projectId === projectId),
				)
				.map((row) => ({ ...row.clone }));
		},
	};
}
