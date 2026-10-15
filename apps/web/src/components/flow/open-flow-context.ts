import { createContext } from "react";

/**
 * Opens another flow file of the project by name, for example a For Each
 * node's body flow. Absent where a canvas cannot navigate.
 */
export const OpenFlowContext = createContext<((name: string) => void) | null>(
	null,
);
