import type { Permissions } from "@nightshift/auth";
import {
	cronError,
	type FlowIssue,
	type KnowledgeSource,
} from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import type { Access } from "../../../access";
import type { Actor } from "../../../contract";
import { savedSource, withSourceSchedule } from "../domain/source-flows";
import { OWNER_ONLY, type SourceRights, savedSchedules } from "../domain/syncs";
import type { SourcesSpace } from "./ports";

const SAVES_FLOWS: Permissions = { flow: ["save"] };

export type SaveKnowledgeSourcePorts = {
	access: Pick<Access, "openSpace">;
	space: Pick<SourcesSpace, "flows" | "listSchedules" | "saveSchedules">;
	/** This computer: a source that reads a folder here syncs here. */
	device: { id: string };
};

/** The source to save, in which project, and what the person may do. */
export type SaveKnowledgeSource = {
	spaceId: string;
	projectId: string;
	/** The flow's name of a source the page added. Unset: a new source. */
	name?: string;
	source: KnowledgeSource;
	/** Its schedule: null removes it, unset leaves it. */
	keepUpToDate?: { cron: string } | null;
	timeZone?: string;
	may: SourceRights;
};

/**
 * Adds a source, or changes one the page added (`name`): its flow, which
 * calls the kit with the values given, and with `keepUpToDate` its
 * schedule (null removes it, unset leaves it). Returns the flow's name and
 * its problems. A source that reads a folder names the computer it reads
 * it on, on its Subflow (`savedSource`). The checks come first, then the
 * flow, then the schedule.
 *
 * Refuses a Person who may not save a flow (`access.openSpace`).
 */
export const saveKnowledgeSource =
	(ports: SaveKnowledgeSourcePorts) =>
	async (
		actor: Actor,
		input: SaveKnowledgeSource,
	): Promise<{ name: string; issues: FlowIssue[] }> => {
		await ports.access.openSpace(actor, {
			spaceId: input.spaceId,
			need: SAVES_FLOWS,
		});
		const { space } = ports;
		const { projectId } = input;
		const changesSchedule = input.keepUpToDate !== undefined;
		if (changesSchedule && !input.may.schedules) {
			throw new Refusal("forbidden", OWNER_ONLY);
		}
		const cron = input.keepUpToDate?.cron;
		const problem = cron === undefined ? null : cronError(cron);
		if (problem) {
			throw new Refusal("invalid", `This schedule is not valid: ${problem}`);
		}
		const { name } = input;
		const saved = savedSource({
			source: input.source,
			...(name !== undefined ? { name } : {}),
			flows: await space.flows.map(projectId),
			here: { device: ports.device.id },
		});
		const issues = await space.flows.save(projectId, saved.name, saved.flow);
		if (changesSchedule) {
			// Its Subflow names the computer: the schedule runs on the Host,
			// and hands that step to the computer.
			await space.saveSchedules(
				projectId,
				withSourceSchedule(
					await savedSchedules(() => space.listSchedules(projectId)),
					saved.name,
					cron === undefined ? null : { cron },
				),
				input.timeZone,
			);
		}
		return { name: saved.name, issues };
	};
