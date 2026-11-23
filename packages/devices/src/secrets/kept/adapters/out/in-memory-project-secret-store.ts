import type { ProjectSecretStore } from "../../application/ports";
import { inMemoryKeptSecrets } from "./in-memory-space-secret-store";

/** The Project secrets of a test, in memory: by Project, then by name. */
export function inMemoryProjectSecretStore(now: () => number) {
	const kept = inMemoryKeptSecrets(now);
	const twin = {
		rows: kept.rows,
		list: kept.list,
		values: kept.values,
		async set(
			project: { spaceId: string; projectId: string },
			name: string,
			value: string,
			setBy: string,
		) {
			kept.set(project.projectId, name, value, setBy);
		},
		remove: kept.remove,
	};
	return twin satisfies ProjectSecretStore;
}
