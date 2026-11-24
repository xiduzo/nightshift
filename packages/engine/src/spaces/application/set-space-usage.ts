import type { Permissions } from "@nightshift/auth";
import { Refusal } from "@nightshift/refusal";
import type { Access } from "../../access";
import type { Actor } from "../../contract";
import { USAGE_ON_HOST } from "../domain/policy";
import type { SpacePolicies } from "./ports";

const SPACE_SETTINGS: Permissions = { space: ["settings"] };

export type SetSpaceUsagePorts = {
	access: Pick<Access, "openSpace">;
	spacePolicies: Pick<SpacePolicies, "setUsage">;
};

/** The Space, and whether its computers may send anonymous usage. */
export type SetSpaceUsage = { spaceId: string; enabled: boolean };

/**
 * Turns anonymous usage on or off for a Space. Refuses a Person who may not change Space settings
 * (`access.openSpace`). A Space a Host keeps is refused: it changes on
 * the Host.
 */
export const setSpaceUsage =
	(ports: SetSpaceUsagePorts) =>
	async (actor: Actor, request: SetSpaceUsage): Promise<void> => {
		await ports.access.openSpace(actor, {
			spaceId: request.spaceId,
			need: SPACE_SETTINGS,
		});
		const changed = await ports.spacePolicies.setUsage(
			request.spaceId,
			request.enabled,
		);
		if (!changed) throw new Refusal("conflict", USAGE_ON_HOST);
	};
