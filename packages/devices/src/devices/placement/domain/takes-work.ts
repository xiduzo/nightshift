/** Which Devices can take the work of a project, and in which order. */

/** Whether a Device can work for the project: it has a Clone, or the project needs none (ADR 22). */
export function hasProject(
	project: { folder: boolean },
	hasClone: boolean,
): boolean {
	return hasClone || project.folder === false;
}

/** Whether each Device can work for the project, by the Clones its Space records. */
export function projectOn(
	project: { folder: boolean },
	clones: readonly { deviceId: string }[],
): (deviceId: string) => boolean {
	const withClone = new Set(clones.map((c) => c.deviceId));
	return (deviceId) => hasProject(project, withClone.has(deviceId));
}

/**
 * Whether a run goes there when nobody names the Device: online, with the
 * project, and no development install (ADR 17). This computer itself is
 * never listed as one.
 */
export function takesRuns(device: {
	online: boolean;
	hasClone: boolean;
	dev?: boolean;
}): boolean {
	return device.online && device.hasClone && !device.dev;
}

/** The Devices a run goes to when none of its order can take it: the one of the project's latest run first. */
export function lastResort(
	devices: readonly (Parameters<typeof takesRuns>[0] & { deviceId: string })[],
	lastRun: string | null | undefined,
): string[] {
	return devices
		.filter(takesRuns)
		.map((d) => d.deviceId)
		.sort((a, b) => Number(b === lastRun) - Number(a === lastRun));
}
