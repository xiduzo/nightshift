import type { SpaceProjects } from "../../keep";

export type ForgetDevicePorts = {
	spaceProjects: Pick<SpaceProjects, "forgetDevice">;
};

/** The Device that is gone. */
export type ForgetDevice = { deviceId: string };

/**
 * Removes a Device from the Space documents this Replica keeps: its
 * Clones and its name. On a Host, when its owner removes a Device for
 * good. A Space a Host keeps elsewhere is that Host's to change.
 */
export const forgetDevice =
	(ports: ForgetDevicePorts) =>
	async (request: ForgetDevice): Promise<void> =>
		ports.spaceProjects.forgetDevice(request.deviceId);
