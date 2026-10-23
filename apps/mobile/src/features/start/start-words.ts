import type { FlowListItem, PlacementChoice } from "@nightshift/client";
import type { FlowInputDef } from "@nightshift/flows";

/** What New run says, without React Native: the flow rows, the computers and why Start run waits. */

/** A flow file that is not valid cannot start. */
export function canRun(
	flow: Pick<FlowListItem, "nodeCount" | "errorCount">,
): boolean {
	return flow.nodeCount !== null && flow.errorCount === 0;
}

/** The line under a flow in the list: its description, or why it cannot start. */
export function flowCaption(
	flow: Pick<FlowListItem, "nodeCount" | "errorCount" | "description">,
): string | undefined {
	if (!canRun(flow)) {
		return "Not valid. Fix it in Night Shift on your computer.";
	}
	return flow.description || undefined;
}

/** What one place is, for the person who picks it. */
export function placementHint(
	choice: Pick<PlacementChoice, "online" | "offers" | "thisDevice">,
): string {
	if (!choice.online) {
		return "Offline. Open Night Shift on that computer to run flows on it.";
	}
	if (choice.offers !== undefined) {
		return choice.offers.length === 0
			? "Another person offers this computer to the Space, with no profiles."
			: `Another person offers this computer to the Space, with ${choice.offers.join(", ")}.`;
	}
	return choice.thisDevice ? "Your Host." : "One of your computers.";
}

function names(inputs: readonly Pick<FlowInputDef, "label" | "name">[]) {
	return inputs.map((input) => input.label || input.name).join(", ");
}

/**
 * Why Start run waits, or null when the run can start. The first thing
 * to do comes first: the flow, the inputs, then the computer.
 */
export function startBlocker({
	flowChosen,
	missing,
	badJson,
	placementsLoaded,
	hasPlace,
}: {
	flowChosen: boolean;
	missing: readonly Pick<FlowInputDef, "label" | "name">[];
	badJson: readonly Pick<FlowInputDef, "label" | "name">[];
	placementsLoaded: boolean;
	hasPlace: boolean;
}): string | null {
	if (!flowChosen) return "Choose a flow first.";
	if (missing.length > 0) return `Fill in ${names(missing)} first.`;
	if (badJson.length > 0) return `Check the format of ${names(badJson)} first.`;
	if (placementsLoaded && !hasPlace) return "No computer can take the run now.";
	return null;
}
