import type { DeviceKeyAccess, DeviceKeyPermission } from "@nightshift/auth";
import { roleAllows, wireSpaces } from "@nightshift/auth";
import type { Database } from "@nightshift/db";
import { ORPCError } from "@orpc/server";
import type { DeviceRegistry } from "../registry";
import { admitKeyedCall } from "./application/admit-keyed-call";
import type { KeyedCallCodes } from "./application/ports";
import { type Host, type HostDeps, wireHost } from "./wire";

export type { Host } from "./wire";

/**
 * The old factories, over `wireHost`, for the database tests and the
 * callers that still name `createHost`.
 */

export function createHost(deps: HostDeps): Host {
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
	const spaces = wireSpaces({ db: deps.db });
	return (key, need) =>
		admitKeyedCall({
			registry: deps.registry,
			settings: { isHost: deps.isHost },
			spaces: {
				of: (personId: string) => spaces.listSpaces({ personId }),
			},
			roles: {
				roleIn: (personId: string, spaceId: string) =>
					spaces.findRole({ personId, spaceId }),
				roleAllows,
			},
			codes,
		})({ key, need });
}
