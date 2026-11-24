import type { Permissions } from "@nightshift/auth";
import type { FlowIssue } from "@nightshift/flows";
import type { Access } from "../../../access";
import { type Actor, personOf } from "../../../contract";
import type { ProjectFlows } from "../../store";
import { restorableFlow, revisionNotFound } from "../domain/revisions";
import type { SpaceProjects } from "./ports";

const SAVES_FLOWS: Permissions = { flow: ["save"] };

export type RestoreFlowRevisionPorts = {
	access: Pick<Access, "openSpace">;
	projects: SpaceProjects;
	flows: Pick<ProjectFlows, "revisions" | "save">;
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
		await ports.access.openSpace(actor, {
			spaceId: request.spaceId,
			need: SAVES_FLOWS,
		});
		await ports.projects.inSpace(projectId, request.spaceId);
		const revision = (await ports.flows.revisions(projectId, name)).find(
			(candidate) => candidate.id === request.revisionId,
		);
		if (revision === undefined) throw revisionNotFound();
		return ports.flows.save(projectId, name, restorableFlow(revision), {
			kind: "restore",
			personId: personOf(actor) ?? undefined,
		});
	};
