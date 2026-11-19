import type { Actor } from "../../contract";
import type { OpenGate } from "../../read";
import type { Access } from "../../runs";
import type { GateLists } from "./ports";

export type ListOpenGatesPorts = {
	/** Opens the Space for the actor (`runs/access`). */
	openSpace: Access["openSpace"];
	gates: Pick<GateLists, "open">;
};

/** Which Space. */
export type ListOpenGates = { spaceId: string };

/**
 * The open Gates of one Space's runs, oldest first, for a Member of the
 * Space. Night Shift (the notifier) reads every Space.
 */
export const listOpenGates =
	(ports: ListOpenGatesPorts) =>
	async (actor: Actor, request: ListOpenGates): Promise<OpenGate[]> => {
		await ports.openSpace(actor, { spaceId: request.spaceId });
		return ports.gates.open(request.spaceId);
	};
