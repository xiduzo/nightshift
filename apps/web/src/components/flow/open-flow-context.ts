import { createContext } from "react";

/**
 * Opens another flow file of the project by name, for example the flow a
 * Call node runs. Absent where a canvas cannot navigate.
 */
export const OpenFlowContext = createContext<((name: string) => void) | null>(
	null,
);
