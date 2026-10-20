import type { Project } from "@/shared/api";

/** What a project without a folder on this computer shows instead of one. */
export const NOT_ON_THIS_COMPUTER = "Not on this computer";

/**
 * The project's folder on this computer, or "Not on this computer": another
 * device of the Space has it.
 */
export function projectFolder(project: Pick<Project, "repoPath">): string {
	return project.repoPath ?? NOT_ON_THIS_COMPUTER;
}
