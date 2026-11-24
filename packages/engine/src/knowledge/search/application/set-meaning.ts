import type { Permissions } from "@nightshift/auth";
import type { Access } from "../../../access";
import type { Actor } from "../../../contract";
import type { KnowledgeDocuments } from "../../sync";
import type { KnowledgeMeaningStatus } from "../domain/meaning";

const CHANGES_KNOWLEDGE: Permissions = { run: ["start"] };

export type SetMeaningPorts = {
	access: Pick<Access, "openSpace">;
	documents: Pick<KnowledgeDocuments, "open">;
	meaning(projectId: string): Promise<KnowledgeMeaningStatus>;
};

/** Turns search by meaning on or off for a project. */
export type SetMeaning = {
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
	async (
		actor: Actor,
		{ spaceId, projectId, on }: SetMeaning,
	): Promise<KnowledgeMeaningStatus> => {
		await ports.access.openSpace(actor, { spaceId, need: CHANGES_KNOWLEDGE });
		await (await ports.documents.open(projectId)).setMeaning(on);
		return ports.meaning(projectId);
	};
