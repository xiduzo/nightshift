/**
 * Two facts of a Device as Placement lists it for a Person: whether it can
 * work for the project, and a profile it offers.
 */

/** Whether a Device can work for the project: it has a Clone, or the project needs none (ADR 22). */
export function hasProject(
	project: { folder: boolean },
	hasClone: boolean,
): boolean {
	return hasClone || project.folder === false;
}

/** An offered profile as a Person picks it: only an Agent Profile is offered. */
export function offeredChoice(offer: {
	profile: string;
	profileName: string;
}): { id: string; name: string; kind: "agent" } {
	return { id: offer.profile, name: offer.profileName, kind: "agent" };
}
