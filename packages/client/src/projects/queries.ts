import type { ApiQueryUtils } from "../api";

/** The query options of projects. */
export function createProjectQueries(orpc: ApiQueryUtils) {
	return {
		/** Every projects query. Invalidate it after a project changes. */
		all: () => orpc.projects.key(),
		/** The projects of the active Space. */
		list: () => orpc.projects.list.queryOptions(),
		/** Whether the folder at `path` can be a project: git, a repository, a commit. */
		check: (path: string) =>
			orpc.projects.check.queryOptions({ input: { path } }),
		/** Every check of the folder at `path`. Invalidate it to check again. */
		checkKey: (path: string) => orpc.projects.check.key({ input: { path } }),
		/** The branches of a project. */
		branches: (projectId: string) =>
			orpc.projects.branches.queryOptions({ input: { projectId } }),
	};
}

/** The mutation options of projects. */
export function createProjectMutations(orpc: ApiQueryUtils) {
	return {
		add: orpc.projects.add.mutationOptions,
		remove: orpc.projects.remove.mutationOptions,
		rename: orpc.projects.rename.mutationOptions,
		move: orpc.projects.move.mutationOptions,
		chooseFolder: orpc.projects.chooseFolder.mutationOptions,
		installGit: orpc.projects.installGit.mutationOptions,
		setUpGit: orpc.projects.setUpGit.mutationOptions,
	};
}
