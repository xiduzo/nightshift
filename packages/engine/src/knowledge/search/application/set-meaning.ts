import type { Permissions } from "@nightshift/auth";
import type { Actor } from "../../../contract";
import type { KnowledgeMeaningStatus } from "../domain/meaning";
import type { MeaningSetting, SearchAccess } from "./ports";

const CHANGES_KNOWLEDGE: Permissions = { run: ["start"] };

export type SetMeaningPorts = {
	access: SearchAccess;
	documents: MeaningSetting;
	meaning(projectId: string): Promise<KnowledgeMeaningStatus>;
};

/** Turns search by meaning on or off for a project. */
export type SetMeaning = {
	actor: Actor;
	spaceId: string;
	projectId: string;
	on: boolean;
};

/**
 * Turns search by meaning on or off for a project, on every computer of
 * its Space. Returns how far it is on this computer.
 *
 * Refuses a Person who may not change knowledge (`access.openSpace`).
 */
export const setMeaning =
	(ports: SetMeaningPorts) =>
	async ({
		actor,
		spaceId,
		projectId,
		on,
	}: SetMeaning): Promise<KnowledgeMeaningStatus> => {
		await ports.access.openSpace(actor, { spaceId, need: CHANGES_KNOWLEDGE });
		await (await ports.documents.open(projectId)).setMeaning(on);
		return ports.meaning(projectId);
	};
