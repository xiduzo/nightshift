import type { Permissions, RoleRefusal } from "@nightshift/auth";
import type { Actor } from "../../contract";
import { SpaceNotFound } from "../domain/refusals";
import type { SpaceMembers } from "./ports";

export type OpenSpacePorts = {
	members: Pick<SpaceMembers, "may">;
	/** The refusal of a role that does not allow the request (`RoleRefusal` of `@nightshift/auth`). */
	RoleRefusal: typeof RoleRefusal;
};

/** Which Space, and what the actor needs to do there. */
export type OpenSpace = {
	spaceId: string;
	/** What the Person's role must allow. Absent: being a Member is enough. */
	need?: Permissions;
};

/**
 * Opens a Space for the actor, for a request keyed by a Space or a
 * project: the same check as `openRun`. A Space the Person is not a
 * Member of is not found (`SpaceNotFound`). A Person whose role does not
 * allow `need` is refused (`RoleRefusal`). Night Shift itself may act in
 * every Space.
 */
export const openSpace =
	(ports: OpenSpacePorts) =>
	async (actor: Actor, request: OpenSpace): Promise<void> => {
		if (!("personId" in actor)) return;
		const may = await ports.members.may(
			request.spaceId,
			actor,
			request.need ?? {},
		);
		if (may === "not-a-member") throw new SpaceNotFound();
		if (may === "no") throw new ports.RoleRefusal();
	};
