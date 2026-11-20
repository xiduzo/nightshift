import type { Actor } from "../../../contract";
import type { KeptValues, SpaceProjects } from "./ports";

export type ResetKeptValuePorts = {
	projects: SpaceProjects;
	kept: Pick<KeptValues, "reset">;
};

/**
 * Forgets the kept value of one variable of a flow: its next run starts
 * from the initial value.
 */
export const resetKeptValue =
	(ports: ResetKeptValuePorts) =>
	async (
		_actor: Actor,
		request: {
			spaceId: string;
			projectId: string;
			flowName: string;
			name: string;
		},
	): Promise<void> => {
		const { spaceId, projectId, flowName } = request;
		await ports.projects.inSpace(projectId, spaceId);
		await ports.kept.reset({ spaceId, projectId, flowName }, request.name);
	};
