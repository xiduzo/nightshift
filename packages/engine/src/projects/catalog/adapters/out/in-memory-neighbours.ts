import type { RunStatus } from "../../../../run-status";
import type { HostRelay, ProjectRuns } from "../../application/ports";

/**
 * The in-memory adapters of the ports that another vertical fills
 * (`@filledBy` in `application/ports.ts`). Test code: production code never
 * imports this file.
 */

/** The Host relay: what it was asked, in order, and the ids it gives. */
export function inMemoryHostRelay() {
	let next = 0;
	const asked: string[] = [];
	const relay = {
		asked,
		async addClone(input: {
			spaceId: string;
			projectId: string;
			deviceId: string;
			deviceName: string;
		}) {
			asked.push(`addClone ${input.spaceId} ${input.projectId}`);
		},
		async addProject(input: { spaceId: string; name: string; remote: string }) {
			asked.push(`addProject ${input.spaceId} ${input.remote}`);
			return { projectId: `hosted-${++next}` };
		},
		async addWithoutFolder(input: { spaceId: string; name: string }) {
			asked.push(`addWithoutFolder ${input.spaceId} ${input.name}`);
			return { projectId: `hosted-${++next}` };
		},
	};
	return relay satisfies HostRelay;
}

/** The runs of the projects: their ids, the ones that run a step, their status. */
export function inMemoryProjectRuns() {
	const runs = new Map<string, { projectId: string; status: RunStatus }>();
	const active = new Set<string>();
	const twin = {
		add(runId: string, projectId: string, status: RunStatus = "running") {
			runs.set(runId, { projectId, status });
		},
		activate(runId: string) {
			active.add(runId);
		},
		async runIds(projectId: string) {
			return [...runs]
				.filter(([, run]) => run.projectId === projectId)
				.map(([id]) => id);
		},
		isActive: (runId: string) => active.has(runId),
		async status(runId: string) {
			return runs.get(runId)?.status ?? "running";
		},
	};
	return twin satisfies ProjectRuns;
}
