import { createContext } from "react";

/**
 * Opens another flow file of the project by name, for example the flow a
 * Call node runs. Absent where a canvas cannot navigate.
 */
export const OpenFlowContext = createContext<((name: string) => void) | null>(
	null,
);

/**
 * Shows the flow a Call node runs inside the canvas, read only, in place of
 * the flow around it. Absent where a canvas cannot look inside a Subflow.
 */
export const EnterSubflowContext = createContext<
	((nodeId: string, flow: string) => void) | null
>(null);
