import {
	applySuggestion,
	type Flow,
	type Suggestion,
	type TextRange,
} from "@nightshift/flows";
import { createContext, useContext } from "react";
import { toast } from "sonner";

/**
 * What the field helpers need from the editor: where the flow is, its
 * draft, and how to change the draft. Undefined outside the editor of one
 * flow (the Subflow view, a variable's schema): no helpers there.
 */
export type FlowAssistant = {
	projectId: string;
	flowName: string;
	/** The editor's draft, saved or not. */
	flow: Flow;
	changeFlow: (change: (flow: Flow) => Flow) => void;
};

export const FlowAssistantContext = createContext<FlowAssistant | undefined>(
	undefined,
);

export function useFlowAssistant(): FlowAssistant | undefined {
	return useContext(FlowAssistantContext);
}

/**
 * Applies `suggestion` to node `nodeId` of the draft, and offers to undo
 * it while the draft is still the one it made. Nothing is saved: the
 * person saves the flow.
 */
export function applyToDraft(
	assistant: FlowAssistant,
	nodeId: string,
	suggestion: Suggestion,
	selection?: TextRange,
): void {
	const after = applySuggestion(assistant.flow, nodeId, suggestion, selection);
	replaceDraft(
		assistant,
		after,
		"Suggestion applied. Save the flow to keep it.",
	);
}

/**
 * Makes `after` the draft, and offers to undo it while the draft is still
 * `after`. Nothing is saved: the person saves the flow. Returns false when
 * `after` is the draft already.
 */
export function replaceDraft(
	assistant: FlowAssistant,
	after: Flow,
	message: string,
): boolean {
	const before = assistant.flow;
	if (after === before) return false;
	assistant.changeFlow(() => after);
	toast.success(message, {
		action: {
			label: "Undo",
			onClick: () =>
				assistant.changeFlow((current) =>
					current === after ? before : current,
				),
		},
	});
	return true;
}
