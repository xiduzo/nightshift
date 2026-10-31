import {
	canStart,
	type FlowListItem,
	hostOwnerHint,
	type PlacementChoice,
} from "@nightshift/client";
import type { FlowInputDef } from "@nightshift/flows";

/** What New run says, without React Native: the flow rows, the inputs it asks for, the computers and why Start run waits. */

/** The chosen flow as far as New run needs it: what it asks for, and whether it can start. */
export type ChosenFlow = { inputs: FlowInputDef[]; valid: boolean };

/**
 * The chosen flow, from its row in the flow list when the Host says the
 * inputs there (this version), else from its file (`flows.get`, an older
 * Host). Null while the file loads.
 */
export function chosenFlow(
	listed: Pick<FlowListItem, "nodeCount" | "errorCount" | "inputs"> | undefined,
	file: { flow: { inputs?: FlowInputDef[] } | null } | undefined,
): ChosenFlow | null {
	// An older Host leaves `inputs` out of the list.
	const inputs = listed?.inputs as FlowInputDef[] | undefined;
	if (listed && inputs !== undefined)
		return { inputs, valid: canStart(listed) };
	if (!file) return null;
	return { inputs: file.flow?.inputs ?? [], valid: file.flow !== null };
}

/** Whether New run reads the chosen flow's file: only when its row in the list does not say its inputs. */
export function readsFlowFile(
	listed: Pick<FlowListItem, "inputs"> | undefined,
): boolean {
	return (listed?.inputs as FlowInputDef[] | undefined) === undefined;
}

/** The line under a flow in the list: its description, or why it cannot start. */
export function flowCaption(
	flow: Pick<FlowListItem, "nodeCount" | "errorCount" | "description">,
): string | undefined {
	if (!canStart(flow)) {
		return "Not valid. Fix it in Night Shift on your computer.";
	}
	return flow.description || undefined;
}

/** What one place is, for the person who picks it: short, with whether it is online. */
export function placementHint(
	choice: Pick<
		PlacementChoice,
		"online" | "offers" | "thisDevice" | "lastRun" | "ownerName"
	>,
): string {
	if (!choice.online) return "Offline. Open Night Shift on it to use it.";
	const host = hostOwnerHint(choice);
	if (host) return host;
	if (choice.offers !== undefined) {
		return choice.offers.length === 0
			? "Another person offers it, with no profiles · online"
			: `Another person offers it, with ${choice.offers.join(", ")} · online`;
	}
	if (choice.thisDevice) return "Host · online";
	return choice.lastRun
		? "Your computer · online · ran the last run"
		: "Your computer · online";
}

/**
 * The inputs New run asks for on the phone: only the ones the run cannot
 * start without. The rest use their defaults. `more` says whether the
 * flow has other inputs, to change on the desktop.
 */
export function phoneInputs<T extends FlowInputDef>(
	inputs: readonly T[],
): { needed: T[]; more: boolean } {
	const needed = inputs.filter(
		(input) =>
			input.type !== "boolean" && input.required === true && !input.default,
	);
	return { needed, more: needed.length < inputs.length };
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
