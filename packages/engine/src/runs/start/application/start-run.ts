import type { Permissions } from "@nightshift/auth";
import { type Actor, personOf, type StartRunInput } from "../../../contract";
import type { Projects } from "../../../projects";
import type { RunSummary } from "../../../read";
import type { Access } from "../../access";
import type { wireWalk } from "../../walk";
import { placeOf } from "../domain/start-place";
import { refuseTestStart } from "../domain/test-run";
import type { SpaceKeeper } from "./ports";
import type { startRunHere } from "./start-run-here";
import type { startRunOnHost } from "./start-run-on-host";

/** What a role must allow to start a run (ADR 4). */
const STARTS_RUNS: Permissions = { run: ["start"] };

export type StartRunPorts = {
	openSpace: Access["openSpace"];
	projects: Pick<Projects, "find">;
	keeper: Pick<SpaceKeeper, "hostedElsewhere" | "reachable">;
	facts: Pick<ReturnType<typeof wireWalk>["facts"], "walkerId">;
	/** The start this computer walks (`startRunHere`). */
	here: ReturnType<typeof startRunHere>;
	/** The start the Host that keeps the Space walks (`startRunOnHost`). */
	onHost: ReturnType<typeof startRunOnHost>;
};

/** A person's start, and the Space they start it in. */
export type StartRun = StartRunInput & { spaceId: string };

/**
 * Starts a run for whom it runs: a person, from a Device, a phone or a
 * browser, or Night Shift in this process. A Person's role in the Space
 * must allow starting runs (`RoleRefusal`), and the project must be in
 * the Space (`not-found`). A Person's start is theirs (`startedBy`).
 *
 * In a Space a Host keeps, the Host walks the run while this computer
 * reaches it (decision 9), and it hears where the person started. Else
 * this computer walks it, on the Run's Device the start names or the one
 * the flow says (`start-place.ts`).
 */
export const startRun =
	(ports: StartRunPorts) =>
	async (actor: Actor, request: StartRun): Promise<RunSummary> => {
		const { spaceId, ...given } = request;
		await ports.openSpace(actor, { spaceId, need: STARTS_RUNS });
		const project = await ports.projects.find(given.projectId, spaceId);
		const person = personOf(actor);
		const input: StartRunInput =
			person === null ? given : { ...given, startedBy: person };
		const trigger = { kind: "manual" } as const;
		// The Host's start knows no trigger: refuse here what it cannot.
		refuseTestStart(input, trigger);
		const byHost =
			(await ports.keeper.hostedElsewhere(project.spaceId)) &&
			(await ports.keeper.reachable(project.spaceId));
		const at = placeOf(input, byHost ? await ports.facts.walkerId() : null);
		if (at.walker === "host") {
			return ports.onHost({
				spaceId: project.spaceId,
				input: { ...input, startedFrom: at.startedFrom },
			});
		}
		const placed =
			at.deviceId === undefined ? input : { ...input, deviceId: at.deviceId };
		return ports.here({ spaceId: project.spaceId, input: placed, trigger });
	};
