import type { Access } from "../../../access";
import type { Actor } from "../../../contract";
import type { ProjectFlows } from "../../store";
import { flowNotFound, type RevisionKind } from "../../store";
import {
	flowHistory,
	type RevisionView,
	revisionView,
} from "../domain/revisions";
import type { Names, SpaceProjects } from "./ports";

/** One revision with its flow, and how it differs from another flow. */
export type FlowRevisionView = RevisionView<RevisionKind>;

export type ReadFlowRevisionPorts = {
	access: Pick<Access, "openSpace">;
	projects: SpaceProjects;
	flows: Pick<ProjectFlows, "flows" | "revisions">;
	names: Names;
};

/**
 * One revision of a flow of a project of the Space with its flow, and the
 * diff to it from `against`: another revision, or the flow as it is now.
 * A Member of the Space may, whatever the role (`access.openSpace`).
 */
export const readFlowRevision =
	(ports: ReadFlowRevisionPorts) =>
	async (
		actor: Actor,
		request: {
			spaceId: string;
			projectId: string;
			name: string;
			revisionId: string;
			against?: string;
		},
	): Promise<FlowRevisionView> => {
		await ports.access.openSpace(actor, { spaceId: request.spaceId });
		const { projectId, name } = request;
		await ports.projects.inSpace(projectId, request.spaceId);
		const history = await flowHistory(name, {
			sources: () => ports.flows.flows(projectId),
			revisions: () => ports.flows.revisions(projectId, name),
			persons: (ids) => ports.names.persons(ids),
			devices: (ids) => ports.names.devices(ids),
			notFound: () => flowNotFound(name),
		});
		return revisionView(history, request.revisionId, request.against);
	};
