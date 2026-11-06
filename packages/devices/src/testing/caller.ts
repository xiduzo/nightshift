import {
	type DeviceKeyAccess,
	ROLE_REFUSAL,
	type Role,
	roleAllows,
} from "@nightshift/auth";
import { ORPCError } from "@orpc/server";
import type { Caller } from "../contract";
import type { Devices } from "../host";

/** What a test says of a Caller: its Person's role per Space, and its Device as paired. */
export type CallerFacts = {
	/** The Person's role in each Space, by Space id. Default: a Member of none. */
	roles?: Record<string, Role>;
	/** The Device as the Host paired it. Default: named after its id, on a guest Host. */
	device?: Partial<Caller["device"]>;
};

/**
 * A Caller a test builds from a key, with the roles it says, so a test of
 * a keyed procedure sets roles and not a registry. It refuses as the
 * Host's Caller does (FORBIDDEN, `may`).
 */
export function callerOf(
	key: DeviceKeyAccess,
	facts: CallerFacts = {},
): Caller {
	const roles = facts.roles ?? {};
	const role = async (spaceId: string) => roles[spaceId] ?? null;
	return {
		...key,
		device: {
			name: key.deviceId,
			homeHost: null,
			...facts.device,
		},
		spaces: async () => Object.keys(roles),
		roleIn: role,
		member: async (spaceId) => (await role(spaceId)) !== null,
		async may(spaceId, need, words = ROLE_REFUSAL.message) {
			const found = await role(spaceId);
			if (!found || !roleAllows(found, need)) {
				throw new ORPCError("FORBIDDEN", { message: words });
			}
		},
	};
}

/**
 * An admission for a Host in memory without a registry: every key is a
 * paired Device of its Person, with the roles given, whatever permission
 * the procedure names. No key is UNAUTHORIZED, as on a Host. The Host's
 * own rules run with its own `admit` (`hostInMemory`).
 */
export function admitEvery(facts: CallerFacts = {}): Devices["admit"] {
	return async (key) => {
		if (!key) {
			throw new ORPCError("UNAUTHORIZED", {
				message: "This device has no access here. Pair it again.",
			});
		}
		return callerOf(key, facts);
	};
}
