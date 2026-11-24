import type { Permissions } from "@nightshift/auth";
import type { Access } from "../../../access";
import type { Actor } from "../../../contract";
import type { KeptValues, SpaceProjects } from "./ports";

const SAVES_FLOWS: Permissions = { flow: ["save"] };

export type ResetKeptValuePorts = {
	access: Pick<Access, "openSpace">;
	projects: SpaceProjects;
	kept: Pick<KeptValues, "reset">;
};

/**
 * Forgets the kept value of one variable of a flow: its next run starts
 * from the initial value. Refuses a Person whose role does not save flows
 * (`access.openSpace`). The door lets only the owner of this computer ask.
 */
export const resetKeptValue =
	(ports: ResetKeptValuePorts) =>
	async (
		actor: Actor,
		request: {
			spaceId: string;
			projectId: string;
			flowName: string;
			name: string;
		},
	): Promise<void> => {
		await ports.access.openSpace(actor, {
			spaceId: request.spaceId,
			need: SAVES_FLOWS,
		});
		const { spaceId, projectId, flowName } = request;
		await ports.projects.inSpace(projectId, spaceId);
		await ports.kept.reset({ spaceId, projectId, flowName }, request.name);
	};
