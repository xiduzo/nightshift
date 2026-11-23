import type { Permissions } from "@nightshift/auth";
import type { PageReaderSetting } from "@nightshift/flows";
import type { Actor } from "../../../contract";
import type { ReaderSettings, ReadersAccess } from "./ports";

const CHANGES_KNOWLEDGE: Permissions = { run: ["start"] };

export type ChooseReaderPorts = {
	access: ReadersAccess;
	settings: Pick<ReaderSettings, "choose">;
};

/** The project, and the reader a person chose for it. */
export type ChooseReader = {
	actor: Actor;
	spaceId: string;
	projectId: string;
	setting: PageReaderSetting;
};

/**
 * Chooses the page reader of the project (ADR 39), for every Device of its
 * Space. Gives the setting back as the Space saved it.
 *
 * Refuses a Person who may not change knowledge (`access.openSpace`).
 */
export const chooseReader =
	(ports: ChooseReaderPorts) =>
	async ({
		actor,
		spaceId,
		projectId,
		setting,
	}: ChooseReader): Promise<PageReaderSetting> => {
		await ports.access.openSpace(actor, { spaceId, need: CHANGES_KNOWLEDGE });
		return ports.settings.choose(projectId, setting);
	};
