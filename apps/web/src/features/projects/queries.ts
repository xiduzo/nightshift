/** The query options of projects (`@nightshift/client`, on this app's client), and their mutations. */

import { createProjectQueries } from "@nightshift/client";

import { orpc } from "@/shared/api";

export const projectQueries = createProjectQueries(orpc);

export const projectMutations = {
	add: orpc.projects.add.mutationOptions,
	addWithoutFolder: orpc.projects.addWithoutFolder.mutationOptions,
	remove: orpc.projects.remove.mutationOptions,
	rename: orpc.projects.rename.mutationOptions,
	move: orpc.projects.move.mutationOptions,
	chooseFolder: orpc.projects.chooseFolder.mutationOptions,
	cloneFromGitHub: orpc.projects.cloneFromGitHub.mutationOptions,
	copyHere: orpc.projects.copyHere.mutationOptions,
	useFolder: orpc.projects.useFolder.mutationOptions,
	installGit: orpc.projects.installGit.mutationOptions,
	setUpGit: orpc.projects.setUpGit.mutationOptions,
};
