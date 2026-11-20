import type { Flow, FlowIssue } from "@nightshift/flows";
import type { RevisionKind } from "../domain/flow-json";
import { checkFlowName, savedIssues } from "../domain/flow-save";
import type { Clock, FlowStore, ProjectSpaces, ThisDevice } from "./ports";

export type SaveProjectFlowPorts = {
	store: Pick<FlowStore, "save">;
	projects: ProjectSpaces;
	device: ThisDevice;
	clock: Clock;
};

/** How a save records its revision. */
export type SaveFlowOptions = {
	/** Why the revision exists. Default `save`. */
	kind?: RevisionKind;
	/** The Person who saves. None for Night Shift's own saves. */
	personId?: string | undefined;
};

/**
 * Saves a flow, a draft with errors too, as a new revision on this Device.
 * Refuses (`invalid`) a name no flow may have, and (`not-found`) a Project
 * this Replica does not have. Returns the issues of the saved flow.
 */
export const saveProjectFlow =
	(ports: SaveProjectFlowPorts) =>
	async (
		request: { projectId: string; name: string; flow: Flow } & SaveFlowOptions,
	): Promise<FlowIssue[]> => {
		const { projectId, name, flow } = request;
		checkFlowName(name);
		await ports.projects.spaceOf(projectId);
		const deviceId = await ports.device.id();
		const stored = await ports.store.save(projectId, {
			name,
			flow,
			kind: request.kind ?? "save",
			personId: request.personId ?? null,
			deviceId,
			at: ports.clock(),
		});
		return savedIssues(flow, name, stored);
	};
