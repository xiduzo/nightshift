import type { Actor } from "../../../contract";
import type { ProjectFlows } from "../../store";
import { flowNotFound, type RevisionKind } from "../../store";
import { flowHistory, type RevisionItem } from "../domain/revisions";
import type { Names, SpaceProjects } from "./ports";

/** One revision of a flow, as a Person lists it. */
export type FlowRevisionItem = RevisionItem<RevisionKind>;

export type ListFlowRevisionsPorts = {
	projects: SpaceProjects;
	flows: Pick<ProjectFlows, "flows" | "revisions">;
	names: Names;
};

/**
 * The revisions of a flow of a project of the Space, newest first: who
 * saved each, when, on which Device, and what it changed from the one
 * before. Refuses (`not-found`) a flow that does not exist.
 */
export const listFlowRevisions =
	(ports: ListFlowRevisionsPorts) =>
	async (
		_actor: Actor,
		request: {
			spaceId: string;
			projectId: string;
			name: string;
		},
	): Promise<FlowRevisionItem[]> => {
		const { projectId, name } = request;
		await ports.projects.inSpace(projectId, request.spaceId);
		const history = await flowHistory(name, {
			sources: () => ports.flows.flows(projectId),
			revisions: () => ports.flows.revisions(projectId, name),
			persons: (ids) => ports.names.persons(ids),
			devices: (ids) => ports.names.devices(ids),
			notFound: () => flowNotFound(name),
		});
		return history.items.reverse();
	};
