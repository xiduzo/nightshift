import type { FlowIssue } from "@nightshift/flows";
import { type Actor, personOf } from "../../../contract";
import {
	revisionFlow,
	revisionNotFound,
	revisionNotValid,
} from "../domain/revisions";
import type { SavedFlows, SpaceProjects } from "./ports";

export type RestoreFlowRevisionPorts = {
	projects: SpaceProjects;
	flows: Pick<SavedFlows, "revisions" | "save">;
};

/**
 * Saves a revision's flow as the flow now: a new revision of kind
 * `restore` by the actor. Returns its issues.
 */
export const restoreFlowRevision =
	(ports: RestoreFlowRevisionPorts) =>
	async (
		actor: Actor,
		request: {
			spaceId: string;
			projectId: string;
			name: string;
			revisionId: string;
		},
	): Promise<FlowIssue[]> => {
		const { projectId, name } = request;
		await ports.projects.inSpace(projectId, request.spaceId);
		const revision = (await ports.flows.revisions(projectId, name)).find(
			(candidate) => candidate.id === request.revisionId,
		);
		if (revision === undefined) throw revisionNotFound();
		const flow = revisionFlow(revision);
		if (flow === null) throw revisionNotValid();
		return ports.flows.save(projectId, name, flow, {
			kind: "restore",
			personId: personOf(actor) ?? undefined,
		});
	};
