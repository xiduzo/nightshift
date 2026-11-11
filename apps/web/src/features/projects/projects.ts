import { hasFolder } from "@nightshift/client";
import { useQuery } from "@tanstack/react-query";
import type { Project } from "@/shared/api";
import { projectQueries } from "./queries";

/** What a project without a folder on this computer shows instead of one. */
export const NOT_ON_THIS_COMPUTER = "Not on this computer";

/**
 * The project's folder on this computer, or "Not on this computer": another
 * device of the Space has it.
 */
export function projectFolder(project: Pick<Project, "repoPath">): string {
	return project.repoPath ?? NOT_ON_THIS_COMPUTER;
}

/**
 * The project has a folder, but this computer has no copy of it. A project
 * without a folder needs no copy anywhere.
 */
export function notHere(project: Pick<Project, "repoPath" | "folder">) {
	return project.repoPath === null && hasFolder(project);
}

/**
 * Whether the project has a folder, for the fields only such a project has
 * ("Start from"). True while the projects load, and for a project of
 * another Space.
 */
export function useHasFolder(projectId: string): boolean {
	const project = useQuery(projectQueries.list()).data?.find(
		(p) => p.id === projectId,
	);
	return project ? hasFolder(project) : true;
}
