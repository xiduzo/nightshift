import type { ApiQueryUtils } from "../api";

/** The query options of projects. */
export function createProjectQueries(orpc: ApiQueryUtils) {
	return {
		/** Every projects query. Invalidate it after a project changes. */
		all: () => orpc.projects.key(),
		/** The projects of the active Space, each with the counts of its runs. */
		list: () => orpc.projects.list.queryOptions(),
		/** Every list of projects. A run that changes changes its counts. */
		lists: () => orpc.projects.list.key(),
		/** Whether the folder at `path` can be a project: git, a repository, a commit. */
		check: (path: string) =>
			orpc.projects.check.queryOptions({ input: { path } }),
		/** Every check of the folder at `path`. Invalidate it to check again. */
		checkKey: (path: string) => orpc.projects.check.key({ input: { path } }),
		/** The branches of a project. */
		branches: (projectId: string) =>
			orpc.projects.branches.queryOptions({ input: { projectId } }),
		/** The runs of a project with a copy or branches left on this computer. */
		runCopies: (projectId: string) =>
			orpc.projects.runCopies.queryOptions({ input: { projectId } }),
		/** Every run-copies query of a project. Invalidate it after a removal. */
		runCopiesKey: (projectId: string) =>
			orpc.projects.runCopies.key({ input: { projectId } }),
		/** How a project can be added on this computer: a folder picker, GitHub. */
		sources: () => orpc.projects.sources.queryOptions(),
		/** The person's GitHub repositories, when GitHub is signed in on this computer. */
		gitHubRepos: () => orpc.projects.gitHubRepos.queryOptions(),
		/** How copying a GitHub repository goes. Polls while it copies. */
		gitHubClone: (repo: string) => ({
			...orpc.projects.gitHubClone.queryOptions({ input: { repo } }),
			refetchInterval: (query: {
				state: { data?: { state: string } | null };
			}) => (query.state.data?.state === "cloning" ? CLONE_POLL_MS : false),
		}),
		/**
		 * The copies of the Space's projects to this computer that run or
		 * failed. A Host starts them on its own, so it is asked about now and then.
		 */
		copies: () => ({
			...orpc.projects.copies.queryOptions(),
			refetchInterval: (query: { state: { data?: { state: string }[] } }) =>
				query.state.data?.some((copy) => copy.state === "copying")
					? COPY_POLL_MS
					: COPIES_POLL_MS,
		}),
	};
}

/** How often a clone from GitHub is asked about while it copies. */
const CLONE_POLL_MS = 1_000;
/** How often the copies of projects are asked about while one runs, and else. */
const COPY_POLL_MS = 2_000;
const COPIES_POLL_MS = 30_000;

/** The mutation options of projects. */
export function createProjectMutations(orpc: ApiQueryUtils) {
	return {
		add: orpc.projects.add.mutationOptions,
		remove: orpc.projects.remove.mutationOptions,
		rename: orpc.projects.rename.mutationOptions,
		move: orpc.projects.move.mutationOptions,
		chooseFolder: orpc.projects.chooseFolder.mutationOptions,
		cloneFromGitHub: orpc.projects.cloneFromGitHub.mutationOptions,
		copyHere: orpc.projects.copyHere.mutationOptions,
		installGit: orpc.projects.installGit.mutationOptions,
		setUpGit: orpc.projects.setUpGit.mutationOptions,
		removeRunCopy: orpc.projects.removeRunCopy.mutationOptions,
		deleteRunBranches: orpc.projects.deleteRunBranches.mutationOptions,
	};
}
