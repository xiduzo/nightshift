import type { Clock, FlowStore, ProjectSpaces, ThisDevice } from "./ports";

export type UpgradeProjectFlowsPorts = {
	store: Pick<FlowStore, "projectIds" | "upgrade">;
	projects: ProjectSpaces;
	device: ThisDevice;
	clock: Clock;
};

/**
 * Brings the flows and the schedules of an older format of every Project
 * whose Space this Replica keeps (`keeps`) to the current format, once
 * (ADR 3, ADR 14): a flow with a revision of kind `upgrade` by Night Shift
 * on this Device. A Project that is gone is left out.
 */
export const upgradeProjectFlows =
	(ports: UpgradeProjectFlowsPorts) =>
	async (request: {
		keeps(spaceId: string): Promise<boolean>;
	}): Promise<void> => {
		const deviceId = await ports.device.id();
		for (const projectId of await ports.store.projectIds()) {
			const spaceId = await ports.projects.spaceOf(projectId).catch(() => null);
			if (spaceId === null || !(await request.keeps(spaceId))) continue;
			await ports.store.upgrade(projectId, {
				deviceId,
				spaceId,
				at: ports.clock(),
			});
		}
	};
