import type { DeviceKeyAccess, DeviceKeyPermission } from "@nightshift/auth";
import { roleAllows, roleIn, spacesOf } from "@nightshift/auth";
import type { Database } from "@nightshift/db";
import { ORPCError } from "@orpc/server";
import type { DeviceRegistry } from "../registry";
import { admitKeyedCall } from "./application/admit-keyed-call";
import type { KeyedCallCodes } from "./application/ports";
import { type Host, type HostDeps, wireHost } from "./wire";

export type { Host };

/**
 * The old factories, over `wireHost`, for the database tests and the
 * callers that still name `createHost`.
 */

export function createHost(deps: HostDeps) {
	return wireHost(deps);
}

const codes: KeyedCallCodes = {
	unauthorized: (words) => {
		throw new ORPCError("UNAUTHORIZED", { message: words });
	},
	forbidden: (words) => {
		throw new ORPCError("FORBIDDEN", { message: words });
	},
};

/** This Host's admission of keyed calls, as the old tests call it. */
export function admission(deps: {
	db: Database;
	registry: Pick<DeviceRegistry, "get">;
	isHost(): boolean;
}): (
	key: DeviceKeyAccess | null,
	need: DeviceKeyPermission | undefined,
) => ReturnType<ReturnType<typeof admitKeyedCall>> {
	return (key, need) =>
		admitKeyedCall({
			registry: deps.registry,
			settings: { isHost: deps.isHost },
			spaces: {
				of: (personId) => spacesOf(deps.db, personId),
			},
			roles: {
				roleIn: (personId, spaceId) => roleIn(deps.db, personId, spaceId),
				roleAllows,
			},
			codes,
		})({ key, need });
}
