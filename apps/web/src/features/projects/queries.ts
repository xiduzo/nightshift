/** The query and mutation options of projects. */

import { orpc } from "@/shared/api";

export const projectQueries = {
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

export const projectMutations = {
	add: orpc.projects.add.mutationOptions,
	remove: orpc.projects.remove.mutationOptions,
	rename: orpc.projects.rename.mutationOptions,
	move: orpc.projects.move.mutationOptions,
	chooseFolder: orpc.projects.chooseFolder.mutationOptions,
	installGit: orpc.projects.installGit.mutationOptions,
	setUpGit: orpc.projects.setUpGit.mutationOptions,
};
