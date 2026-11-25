import { Refusal } from "@nightshift/refusal";
import { NotOnThisComputer, type StartRunInput } from "../../../contract";
import type { RunTrigger } from "../../../log";
import type { Projects } from "../../../projects";
import type { RunSummary } from "../../../read";
import type { wireWalk } from "../../walk";
import { placeOf, SCHEDULE_PROJECT_MISSING } from "../domain/start-place";
import { refuseTestStart } from "../domain/test-run";
import type { SpaceKeeper } from "./ports";
import type { startRunHere } from "./start-run-here";
import type { startRunOnHost } from "./start-run-on-host";

export type StartScheduledRunPorts = {
	projects: Pick<Projects, "find">;
	keeper: SpaceKeeper;
	facts: Pick<ReturnType<typeof wireWalk>["facts"], "walkerId">;
	/** The start this computer walks (`startRunHere`). */
	here: ReturnType<typeof startRunHere>;
	/** The start the Host that keeps the Space walks (`startRunOnHost`). */
	onHost: ReturnType<typeof startRunOnHost>;
};

/** A schedule's or a webhook's start: what it starts, and the schedule that started it. */
export type StartScheduledRun = {
	input: StartRunInput;
	trigger: RunTrigger;
};

/**
 * A schedule's or a webhook's start, also Run now: for the schedule's
 * Person, else this computer's owner. It always runs on the Replica that
 * keeps the Space: its Host, or this computer in a Space without one
 * (ADR 15). It does not move to another Device. A Host without a copy of
 * the project refuses it in the words of a schedule
 * (`SCHEDULE_PROJECT_MISSING`). Only Night Shift starts it: no role
 * applies.
 */
export const startScheduledRun =
	(ports: StartScheduledRunPorts) =>
	async (request: StartScheduledRun): Promise<RunSummary> => {
		const { trigger } = request;
		const { spaceId } = await ports.projects.find(request.input.projectId);
		const deviceId =
			(await ports.keeper.hostOf(spaceId)) ?? (await ports.facts.walkerId());
		const input = { ...request.input, deviceId };
		try {
			// The Host's start knows no trigger: refuse here what it cannot.
			refuseTestStart(input, trigger);
			const byHost =
				(await ports.keeper.hostedElsewhere(spaceId)) &&
				(await ports.keeper.reachable(spaceId));
			const at = placeOf(input, byHost ? await ports.facts.walkerId() : null);
			if (at.walker === "host") {
				return await ports.onHost({
					spaceId,
					input: { ...input, startedFrom: at.startedFrom },
				});
			}
			return await ports.here({ spaceId, input, trigger });
		} catch (error) {
			if (error instanceof NotOnThisComputer) {
				throw new Refusal(error.kind, SCHEDULE_PROJECT_MISSING);
			}
			throw error;
		}
	};
