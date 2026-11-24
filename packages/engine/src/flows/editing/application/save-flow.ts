import type { Permissions } from "@nightshift/auth";
import type { Flow, FlowIssue } from "@nightshift/flows";
import type { Access } from "../../../access";
import { type Actor, personOf } from "../../../contract";
import type { FlowUsage, SavedFlows, SpaceProjects } from "./ports";

const SAVES_FLOWS: Permissions = { flow: ["save"] };

export type SaveFlowPorts = {
	access: Pick<Access, "openSpace">;
	projects: SpaceProjects;
	flows: Pick<SavedFlows, "flows" | "save">;
	usage?: FlowUsage;
};

/**
 * Saves a flow of a project of the Space, a draft with errors too, as a
 * new revision by the actor. A new flow is noted for anonymous usage.
 * Returns the issues of the saved flow.
 */
export const saveFlow =
	(ports: SaveFlowPorts) =>
	async (
		actor: Actor,
		request: {
			spaceId: string;
			projectId: string;
			name: string;
			flow: Flow;
		},
	): Promise<FlowIssue[]> => {
		const { projectId, name } = request;
		await ports.access.openSpace(actor, {
			spaceId: request.spaceId,
			need: SAVES_FLOWS,
		});
		await ports.projects.inSpace(projectId, request.spaceId);
		const existed = Object.hasOwn(await ports.flows.flows(projectId), name);
		const issues = await ports.flows.save(projectId, name, request.flow, {
			personId: personOf(actor) ?? undefined,
		});
		if (!existed) ports.usage?.note({ kind: "flow-created", from: "blank" });
		return issues;
	};
