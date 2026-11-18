import type { DeviceProfile } from "@nightshift/engine";
import type { ListedProject } from "@nightshift/engine/projects";

/** Two facts of a Device as Placement lists it for a Person: whether it can work for the project, and a profile it offers. */

/** Whether a Device can work for the project: it has a Clone, or the project needs none (ADR 22). */
export function hasProject(project: ListedProject, hasClone: boolean): boolean {
	return hasClone || project.folder === false;
}

/** An offered profile as a Person picks it: only an Agent Profile is offered. */
export function offeredChoice(offer: {
	profile: string;
	profileName: string;
}): DeviceProfile {
	return { id: offer.profile, name: offer.profileName, kind: "agent" };
}
