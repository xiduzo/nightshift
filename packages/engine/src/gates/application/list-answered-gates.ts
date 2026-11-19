import type { Actor } from "../../contract";
import type { AnsweredGate } from "../../read";
import type { Access } from "../../runs";
import type { GateLists } from "./ports";

export type ListAnsweredGatesPorts = {
	/** Opens the Space for the actor (`runs/access`). */
	openSpace: Access["openSpace"];
	gates: Pick<GateLists, "answered">;
};

/** Which Space, and since when. */
export type ListAnsweredGates = { spaceId: string; since: number };

/**
 * The Gates of one Space's runs that closed after `since`, newest first,
 * for a Member of the Space.
 */
export const listAnsweredGates =
	(ports: ListAnsweredGatesPorts) =>
	async (actor: Actor, request: ListAnsweredGates): Promise<AnsweredGate[]> => {
		await ports.openSpace(actor, { spaceId: request.spaceId });
		return ports.gates.answered(request.spaceId, request.since);
	};
