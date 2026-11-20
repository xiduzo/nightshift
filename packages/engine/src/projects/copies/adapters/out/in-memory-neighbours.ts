import type { CopyGround, CopySpaces } from "../../application/ports";
import {
	type CopyProject,
	type CopySpace,
	createCopyState,
} from "../../domain/copies";
import { inMemoryCloneOrigins } from "./in-memory-clone-origins";
import { inMemoryGitHubClones } from "./in-memory-git-hub-clones";

/**
 * The in-memory adapters of the ports that another vertical fills
 * (`@filledBy` in `application/ports.ts`), and `inMemoryCopiesPorts`, which
 * gives a use-case test every port of the copies at once. Test code:
 * production code never imports this file.
 */

/** A Space whose `addProject` makes the folder the Clone here of the project with its remote. */
export function inMemoryCopySpace(
	projects: CopyProject[],
	originOf: (path: string) => string | undefined,
) {
	const added: string[] = [];
	const space = {
		added,
		projects,
		async listProjects() {
			return projects;
		},
		async addProject({ repoPath }: { repoPath: string }) {
			added.push(repoPath);
			const origin = originOf(repoPath);
			const found = projects.find((p) => p.remote === origin);
			if (!found) throw new Error(`No project has origin ${origin}`);
			found.repoPath = repoPath;
			return found;
		},
	};
	return space satisfies CopySpace;
}

/** The Spaces of this computer, with the switch of the sweep. */
export function inMemoryCopySpaces(spaces: Record<string, CopySpace> = {}) {
	const twin = {
		on: true,
		spaces,
		async spaceIds() {
			return Object.keys(spaces);
		},
		space: (spaceId: string) => spaces[spaceId] as CopySpace,
		enabled: () => twin.on,
	};
	return twin satisfies CopySpaces;
}

/** The clock (a test sets `at`), the GitHub names, and the usage notes. */
export function inMemoryCopyGround() {
	const twin = {
		at: 0,
		notes: 0,
		now: () => twin.at,
		isGitHub: (remote: string) => remote.startsWith("github.com/"),
		added() {
			twin.notes += 1;
		},
	};
	return twin satisfies CopyGround;
}

/** Every port of the copies in memory at once: where each use-case test starts. */
export function inMemoryCopiesPorts() {
	return {
		gitHub: inMemoryGitHubClones({ instant: true }),
		origins: inMemoryCloneOrigins(),
		ground: inMemoryCopyGround(),
		spaces: inMemoryCopySpaces(),
		state: createCopyState(),
	};
}
