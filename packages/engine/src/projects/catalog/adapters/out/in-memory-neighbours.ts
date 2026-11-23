import type { Permissions } from "@nightshift/auth";
import type { Actor } from "../../../../contract";
import type { RunStatus } from "../../../../run-status";
import { inMemoryKeepPorts } from "../../../keep/adapters/out/in-memory-neighbours";
import type {
	CloneImports,
	HostRelay,
	ProjectAccess,
	ProjectRuns,
} from "../../application/ports";

/**
 * The in-memory adapters of the ports that another vertical fills
 * (`@filledBy` in `application/ports.ts`), and `inMemoryCatalogPorts`,
 * which gives a use-case test every port of the catalog at once, with the
 * shared ones of `keep`. Test code: production code never imports this
 * file.
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

/** The imports of the flows of a Clone: the projects asked, in order. */
export function inMemoryCloneImports() {
	const imported: string[] = [];
	const twin = {
		imported,
		async importClone(projectId: string) {
			imported.push(projectId);
		},
	};
	return twin satisfies CloneImports;
}

/** Who may act in the Spaces of a test: everyone, until the test refuses Persons. */
export type InMemoryProjectAccess = ProjectAccess & {
	opened: { actor: Actor; spaceId: string; need?: Permissions }[];
	refuse(error: unknown): void;
};

export function inMemoryProjectAccess(): InMemoryProjectAccess {
	let refusal: { error: unknown } | null = null;
	const access: InMemoryProjectAccess = {
		opened: [],
		refuse: (error) => {
			refusal = { error };
		},
		async openSpace(actor, request) {
			access.opened.push({ actor, ...request });
			if (refusal && "personId" in actor) throw refusal.error;
		},
	};
	return access;
}

/** Every port of the catalog in memory at once: where each use-case test starts. */
export function inMemoryCatalogPorts() {
	return {
		access: inMemoryProjectAccess(),
		...inMemoryKeepPorts(),
		relay: inMemoryHostRelay(),
		runs: inMemoryProjectRuns(),
		cloneImports: inMemoryCloneImports(),
	};
}
