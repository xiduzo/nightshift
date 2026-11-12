import { createContext, useContext } from "react";

/**
 * Whether the project has a folder (ADR 22), for the editor's fields. A
 * project without one has no branches and no git history, so the fields do
 * not offer what reads them. True while the project loads, and for an
 * older Host that does not say (`useHasFolder`).
 */
export const ProjectFolderContext = createContext(true);

export function useProjectFolder(): boolean {
	return useContext(ProjectFolderContext);
}
