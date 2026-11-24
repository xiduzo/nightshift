import type { Permissions } from "@nightshift/auth";
import type { Access } from "../../../access";
import type { Actor } from "../../../contract";
import type { ProjectFlows } from "../../store";
import type { SpaceProjects } from "./ports";

const SAVES_FLOWS: Permissions = { flow: ["save"] };

export type DismissFlowNoticePorts = {
	access: Pick<Access, "openSpace">;
	projects: SpaceProjects;
	flows: Pick<ProjectFlows, "dismissNotice">;
};

/**
 * Removes a notice of the flows of a project of the Space, on every Device
 * of the Space. Refuses a Person whose role does not save flows
 * (`access.openSpace`). The door lets only the owner of this computer ask.
 */
export const dismissFlowNotice =
	(ports: DismissFlowNoticePorts) =>
	async (
		actor: Actor,
		request: {
			spaceId: string;
			projectId: string;
			noticeId: string;
		},
	): Promise<void> => {
		await ports.access.openSpace(actor, {
			spaceId: request.spaceId,
			need: SAVES_FLOWS,
		});
		await ports.projects.inSpace(request.projectId, request.spaceId);
		await ports.flows.dismissNotice(request.projectId, request.noticeId);
	};
