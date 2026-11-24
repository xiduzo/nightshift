import type { Project } from "./types";

/**
 * Whether the project has a folder (ADR 22). A project without one has no
 * copy on any computer, no branches and no "Start from": each run works in
 * an empty folder of its own.
 */
export function hasFolder(project: Pick<Project, "folder">): boolean {
	return project.folder;
}
