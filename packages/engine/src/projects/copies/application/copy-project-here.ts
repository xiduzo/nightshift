import { Refusal } from "@nightshift/refusal";
import { PROJECT_NOT_FOUND } from "../../keep";
import {
	beginCopy,
	type CopySpace,
	type CopyState,
	NOTHING_TO_COPY,
	type ProjectCopy,
} from "../domain/copies";
import type { CloneOrigins, CopyGround, GitHubClones } from "./ports";

export type CopyPorts = {
	gitHub: Pick<GitHubClones, "copy">;
	origins: CloneOrigins;
	ground: CopyGround;
	/** The copies that run and failed, for the life of the copies. */
	state: CopyState;
};

/** The steps of a copy, from the ports. */
const stepsOf = (ports: CopyPorts) => ({
	isGitHub: (remote: string) => ports.ground.isGitHub(remote),
	clone: (remote: string) => ports.gitHub.copy(remote),
	matchOrigin: (path: string, remote: string) =>
		ports.origins.match(path, remote),
	added: () => ports.ground.added(),
	now: () => ports.ground.now(),
});

/** The Space of the person who asks, and its project. */
export type CopyProjectHere = { space: CopySpace; projectId: string };

/**
 * Copies the project to this computer now, also after a failed try.
 * Resolves when it is done (null) or failed (the copy). Refuses a project
 * without a folder. The door checks the owner of this computer.
 */
export const copyProjectHere =
	(ports: CopyPorts) =>
	async (request: CopyProjectHere): Promise<ProjectCopy | null> => {
		const { space, projectId } = request;
		const project = (await space.listProjects()).find(
			(p) => p.id === projectId,
		);
		if (!project) throw new Refusal("not-found", PROJECT_NOT_FOUND);
		if (!project.folder) throw new Refusal("conflict", NOTHING_TO_COPY);
		if (project.repoPath !== null) return null;
		return beginCopy(stepsOf(ports), ports.state, space, project);
	};
