import type { Permissions } from "@nightshift/auth";
import type { Access } from "../../../access";
import type { Actor } from "../../../contract";
import type { LearningEntries } from "./ports";

const CHANGES_KNOWLEDGE: Permissions = { run: ["start"] };

export type SetLearnsFromRunsPorts = {
	access: Pick<Access, "openSpace">;
	documents: Pick<LearningEntries, "open">;
};

/** The project, and whether Night Shift learns from its runs. */
export type SetLearnsFromRuns = {
	actor: Actor;
	spaceId: string;
	projectId: string;
	on: boolean;
};

/**
 * Turns the learnings from runs on or off for the project, for every
 * Device of its Space.
 *
 * Refuses a Person who may not change knowledge (`access.openSpace`).
 */
export const setLearnsFromRuns =
	(ports: SetLearnsFromRunsPorts) =>
	async ({
		actor,
		spaceId,
		projectId,
		on,
	}: SetLearnsFromRuns): Promise<void> => {
		await ports.access.openSpace(actor, { spaceId, need: CHANGES_KNOWLEDGE });
		await (await ports.documents.open(projectId)).setLearnsFromRuns(on);
	};
