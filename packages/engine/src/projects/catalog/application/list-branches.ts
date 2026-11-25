import { Refusal } from "@nightshift/refusal";
import type { Access } from "../../../access";
import { type Actor, NotOnThisComputer } from "../../../contract";
import type { Branches } from "../../../git";
import { PROJECT_NOT_FOUND, type ProjectStore, type Repos } from "../../keep";

export type ListBranchesPorts = {
	access: Pick<Access, "openSpace">;
	store: Pick<ProjectStore, "find" | "here">;
	repos: Pick<Repos, "branches">;
};

/** The project whose branches to list. */
export type ListBranches = { spaceId: string; projectId: string };

/**
 * The local and remote branches of the project's folder here, for "Start
 * from". A project without a folder has none (ADR 22). A project not on
 * this computer is refused. Read-only, no fetch. A Member of the Space may,
 * whatever the role (`access.openSpace`).
 */
export const listBranches =
	(ports: ListBranchesPorts) =>
	async (actor: Actor, request: ListBranches): Promise<Branches> => {
		const { spaceId, projectId } = request;
		await ports.access.openSpace(actor, { spaceId });
		const found = await ports.store.find(projectId, spaceId);
		if (!found) throw new Refusal("not-found", PROJECT_NOT_FOUND);
		if (!found.folder) return { current: null, local: [], remote: [] };
		const [row] = await ports.store.here({ projectId, kept: true, spaceId });
		if (row) return ports.repos.branches(row.repoPath);
		throw (await ports.store.find(projectId, spaceId))
			? new NotOnThisComputer()
			: new Refusal("not-found", PROJECT_NOT_FOUND);
	};
