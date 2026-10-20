import { createContext, useContext } from "react";

import type { ProjectFlowMap } from "../flow-draft";

/**
 * The project's flow files, by name, for the editor's fields: the flows a
 * Call node can call, their inputs and outputs. Undefined
 * while they load. The flow open in the editor is left out: its draft is newer.
 */
export const ProjectFlowsContext = createContext<ProjectFlowMap | undefined>(
	undefined,
);

export function useProjectFlowMap(): ProjectFlowMap | undefined {
	return useContext(ProjectFlowsContext);
}
