import { beginCopy, type CopyState, wantsCopy } from "../domain/copies";
import type {
	CloneOrigins,
	CopyGround,
	CopySpaces,
	GitHubClones,
} from "./ports";

type CopyPorts = {
	gitHub: Pick<GitHubClones, "copy">;
	origins: CloneOrigins;
	ground: CopyGround;
	state: CopyState;
};

export type SweepProjectCopiesPorts = CopyPorts & { spaces: CopySpaces };

/** The steps of a copy, from the ports. */
const stepsOf = (ports: CopyPorts) => ({
	isGitHub: (remote: string) => ports.ground.isGitHub(remote),
	clone: (remote: string) => ports.gitHub.copy(remote),
	matchOrigin: (path: string, remote: string) =>
		ports.origins.match(path, remote),
	added: () => ports.ground.added(),
	now: () => ports.ground.now(),
});

/**
 * When the switch is on: copies each project of each Space that has a
 * folder, a remote and no Clone here, one at a time. A failed one waits
 * for its retry. A sweep that runs is joined, not started twice.
 */
export const sweepProjectCopies =
	(ports: SweepProjectCopiesPorts) => (): Promise<void> => {
		const { spaces, state } = ports;
		if (!spaces.enabled()) return Promise.resolve();
		state.sweeping ??= (async () => {
			for (const spaceId of await spaces.spaceIds()) {
				if (!spaces.enabled()) return;
				const space = spaces.space(spaceId);
				for (const project of await space.listProjects()) {
					// A project without a remote is only on the computer that has its
					// folder. A project without a folder has nothing to copy.
					if (!wantsCopy(project)) continue;
					const failure = state.failed.get(project.id);
					if (failure && failure.retryAt > ports.ground.now()) continue;
					// One at a time: a Host may have many projects to copy.
					await beginCopy(stepsOf(ports), state, space, project);
				}
			}
		})()
			.catch((error) => {
				console.warn(
					"[projects] the sweep for projects to copy failed:",
					error,
				);
			})
			.finally(() => {
				state.sweeping = null;
			});
		return state.sweeping;
	};
