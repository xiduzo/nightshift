import {
	defineProject,
	normaliseRemote,
	type ProjectStore,
	type Repos,
	type SpaceProjects,
} from "../../keep";

export type ReadRemotesPorts = {
	store: Pick<ProjectStore, "here" | "byRemote">;
	spaceProjects: Pick<SpaceProjects, "define">;
	repos: Pick<Repos, "origin">;
};

/**
 * Reads the remote of every project here that has none, from its Clone
 * here: rows from before the Clone table get theirs this way (a migration
 * cannot run git). A folder that is gone is skipped. A remote another
 * project already has stays off: the two stay apart, as they were.
 */
export const readRemotes =
	(ports: ReadRemotesPorts) => async (): Promise<void> => {
		for (const row of await ports.store.here({ withoutRemote: true })) {
			const url = await ports.repos.origin(row.repoPath).catch(() => null);
			const remote = url === null ? null : normaliseRemote(url);
			if (remote === null) continue;
			if (await ports.store.byRemote(remote)) continue;
			await defineProject(
				(r, change) => ports.spaceProjects.define(r, change),
				row,
				{ remote },
			);
		}
	};
