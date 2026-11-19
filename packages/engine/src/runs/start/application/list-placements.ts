import { Refusal } from "@nightshift/refusal";
import { type Actor, type Placement, personOf } from "../../../contract";
import type { Access } from "../../access";
import { markDefault } from "../domain/start-place";
import type { RunPlanner } from "./ports";

export type ListPlacementsPorts = {
	openSpace: Access["openSpace"];
	planner: Pick<RunPlanner, "placements" | "lastRunDevice">;
};

/** The project whose run the person is about to start, and its Space. */
export type ListPlacements = { spaceId: string; projectId: string };

/**
 * The Devices a run of the project can run on, for the Person who starts
 * it: the one of the project's latest run and the default a start takes
 * marked (`markDefault`), for a screen that must preselect one. Needs a
 * Person (`signed-out`) who is a Member of the Space (`SpaceNotFound`).
 */
export const listPlacements =
	(ports: ListPlacementsPorts) =>
	async (actor: Actor, request: ListPlacements): Promise<Placement[]> => {
		const { spaceId, projectId } = request;
		const personId = personOf(actor);
		if (personId === null) {
			throw new Refusal("signed-out", "Sign in to start a run.");
		}
		await ports.openSpace(actor, { spaceId });
		const last = await ports.planner.lastRunDevice(projectId);
		return markDefault(
			await ports.planner.placements(spaceId, personId, projectId),
			last,
		);
	};
