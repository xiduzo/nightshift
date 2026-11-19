import { Refusal } from "@nightshift/refusal";
import {
	type Actor,
	type NodeToPlace,
	type OwnDevice,
	personOf,
} from "../../../contract";
import type { Access } from "../../access";
import type { RunPlanner } from "./ports";

export type ListDevicesPorts = {
	openSpace: Access["openSpace"];
	planner: Pick<RunPlanner, "devicesFor">;
};

/** The project of the run, its Space, and the node to place when the person places one. */
export type ListDevices = {
	spaceId: string;
	projectId: string;
	forNode?: NodeToPlace;
};

/**
 * The Devices the Person may place a run's steps on: their own, then
 * others' through Offers. With `forNode`, the Devices that node may name.
 * Needs a Person (`signed-out`) who is a Member of the Space.
 */
export const listDevices =
	(ports: ListDevicesPorts) =>
	async (actor: Actor, request: ListDevices): Promise<OwnDevice[]> => {
		const { spaceId, projectId, forNode } = request;
		const personId = personOf(actor);
		if (personId === null) {
			throw new Refusal("signed-out", "Sign in to see your devices.");
		}
		await ports.openSpace(actor, { spaceId });
		return ports.planner.devicesFor(spaceId, personId, projectId, forNode);
	};
