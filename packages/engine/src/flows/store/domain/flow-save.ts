import {
	FLOW_VERSION,
	type Flow,
	type FlowIssue,
	type FlowSources,
	flowNameSchema,
	parsedFlows,
	parseFlow,
	type ScheduleIssue,
} from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import type { FlowFormat, RevisionKind } from "./flow-json";

/** Refuses (`invalid`) a name that no flow may have. */
export function checkFlowName(name: string): void {
	const valid = flowNameSchema.safeParse(name);
	if (!valid.success) {
		throw new Refusal(
			"invalid",
			`The flow name "${name}" is not valid. ${valid.error.issues[0]?.message ?? "Pick another name."}`,
		);
	}
}

/** The refusal of a change to a flow that another version of Night Shift saved. */
export function foreignFlow(
	name: string,
	format: Exclude<FlowFormat, "current">,
): Refusal {
	return new Refusal(
		"conflict",
		format === "newer"
			? `A newer version of Night Shift saved the flow "${name}". Update Night Shift to change it.`
			: `An older version of Night Shift made the flow "${name}". You cannot change it here. Delete it, or use another name.`,
	);
}

/** The refusal of a flow that does not exist. */
export function flowNotFound(name: string): Refusal {
	return new Refusal("not-found", `The flow "${name}" does not exist.`);
}

/**
 * The issues of a saved flow, among the flows of the project as they are
 * stored after the save.
 */
export function savedIssues(
	flow: Flow,
	name: string,
	stored: FlowSources,
): FlowIssue[] {
	const current: Flow = { ...flow, version: FLOW_VERSION };
	return parseFlow(current, { flows: parsedFlows(stored), name }).issues;
}

/** What a read of the schedules says when a newer Night Shift saved some of them. */
export function unreadableSchedules(unreadable: number): ScheduleIssue[] {
	return unreadable > 0
		? [
				{
					severity: "warning",
					message:
						"A newer version of Night Shift saved some schedules. Update Night Shift to see them.",
				},
			]
		: [];
}

/** A save of a flow as the store writes it: the flow, and its revision. */
export type FlowSave = {
	name: string;
	flow: Flow;
	kind: RevisionKind;
	/** The Person who saves. Null for Night Shift's own saves. */
	personId: string | null;
	deviceId: string;
	at: number;
};
