import { Refusal } from "@nightshift/refusal";
import type { Actor } from "../../contract";
import { USAGE_ON_HOST } from "../domain/policy";
import type { SpacePolicies } from "./ports";

export type SetSpaceUsagePorts = {
	spacePolicies: Pick<SpacePolicies, "setUsage">;
};

/** The Space, and whether its computers may send anonymous usage. */
export type SetSpaceUsage = { spaceId: string; enabled: boolean };

/**
 * Turns anonymous usage on or off for a Space. The door checks the
 * person's role first. A Space a Host keeps is refused: it changes on
 * the Host.
 */
export const setSpaceUsage =
	(ports: SetSpaceUsagePorts) =>
	async (_actor: Actor, request: SetSpaceUsage): Promise<void> => {
		const changed = await ports.spacePolicies.setUsage(
			request.spaceId,
			request.enabled,
		);
		if (!changed) throw new Refusal("conflict", USAGE_ON_HOST);
	};
