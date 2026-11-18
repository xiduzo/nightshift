import type { Schedule, ScheduleIssue } from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import type { Actor } from "../../contract";
import { NOT_ON_THIS_COMPUTER } from "../../projects";
import type { UsageNotes } from "../../usage";
import { withTimeZone } from "../domain/saved-schedules";
import type { ScheduledProjects, ScheduleOffers, ScheduleStore } from "./ports";

export type SaveSchedulesPorts = {
	projects: Pick<ScheduledProjects, "inSpace">;
	offers: ScheduleOffers;
	store: Pick<ScheduleStore, "flows" | "save">;
	/** Anonymous usage, when this computer records it. */
	usage?: UsageNotes;
};

export type SaveSchedules = {
	spaceId: string;
	projectId: string;
	schedules: readonly Schedule[];
	/** The saver's clock: each schedule with a time and no time zone of its own gets it. */
	timeZone?: string;
};

/**
 * Saves the schedules of a project, those with problems too, and returns
 * the issues. A schedule on another Person's Device gets the saver as its
 * Person, when that Device's Offers cover what its flow runs there.
 *
 * Refuses (`not-found`) a project that is not in the Space, and
 * (`conflict`) a project with a folder that has no Clone on this
 * computer, before the Offers are asked. A project without a folder needs
 * no Clone (ADR 22). It tells no screen: the change of the flow document
 * does.
 */
export const saveSchedules =
	(ports: SaveSchedulesPorts) =>
	async (
		actor: Actor | undefined,
		request: SaveSchedules,
	): Promise<ScheduleIssue[]> => {
		const { projects, offers, store, usage } = ports;
		const { spaceId, projectId, schedules, timeZone } = request;

		const project = await projects.inSpace(projectId, spaceId);
		if (project.hasFolder && !project.clonedHere) {
			throw new Refusal("conflict", NOT_ON_THIS_COMPUTER);
		}
		const written = await offers.schedulesWithOffers(
			{ id: projectId, flows: () => store.flows(projectId) },
			spaceId,
			actor,
			timeZone ? withTimeZone(schedules, timeZone) : schedules,
		);
		const issues = await store.save(projectId, written);
		for (const schedule of written) {
			usage?.note({
				kind: "schedule-changed",
				enabled: schedule.enabled,
				webhook: schedule.webhook !== undefined,
				scorePullRequests: schedule.scorePullRequests === true,
			});
		}
		return issues;
	};
