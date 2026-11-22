import type { PageReaderSetting } from "@nightshift/flows";
import type { ReaderSettings } from "./ports";

export type ChooseReaderPorts = {
	settings: Pick<ReaderSettings, "choose">;
};

/** The project, and the reader a person chose for it. */
export type ChooseReader = { projectId: string; setting: PageReaderSetting };

/**
 * Chooses the page reader of the project (ADR 39), for every Device of its
 * Space. Gives the setting back as the Space saved it.
 *
 * It checks no role: the `Knowledge` door has no actor yet (E-doors adds it).
 */
export const chooseReader =
	(ports: ChooseReaderPorts) =>
	({ projectId, setting }: ChooseReader): Promise<PageReaderSetting> =>
		ports.settings.choose(projectId, setting);
