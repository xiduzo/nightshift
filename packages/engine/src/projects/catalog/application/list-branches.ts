import { Refusal } from "@nightshift/refusal";
import type { Actor } from "../../../contract";
import type { Branches } from "../../../git";
import {
	NOT_ON_THIS_COMPUTER,
	PROJECT_NOT_FOUND,
	type ProjectStore,
	type Repos,
} from "../../keep";

export type ListBranchesPorts = {
	store: Pick<ProjectStore, "find" | "here">;
	repos: Pick<Repos, "branches">;
};

/** The project whose branches to list. */
export type ListBranches = { spaceId: string; projectId: string };

/**
 * The local and remote branches of the project's folder here, for "Start
 * from". A project without a folder has none (ADR 22). A project not on
 * this computer is refused. Read-only, no fetch.
 */
export const listBranches =
	(ports: ListBranchesPorts) =>
	async (_actor: Actor, request: ListBranches): Promise<Branches> => {
		const { spaceId, projectId } = request;
		const found = await ports.store.find(projectId, spaceId);
		if (!found) throw new Refusal("not-found", PROJECT_NOT_FOUND);
		if (!found.folder) return { current: null, local: [], remote: [] };
		const [row] = await ports.store.here({ projectId, kept: true, spaceId });
		if (row) return ports.repos.branches(row.repoPath);
		throw (await ports.store.find(projectId, spaceId))
			? new Refusal("conflict", NOT_ON_THIS_COMPUTER)
			: new Refusal("not-found", PROJECT_NOT_FOUND);
	};
