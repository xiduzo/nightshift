import {
	type DeviceKeyAccess,
	type DeviceKeyPermission,
	ROLE_REFUSAL,
	type Role,
	roleAllows,
	roleIn,
	spacesOf,
} from "@nightshift/auth";
import type { Database } from "@nightshift/db";
import { HostUnreachableError } from "@nightshift/engine";
import { FAILURE_MESSAGE, Refusal } from "@nightshift/refusal";
import { ORPCError } from "@orpc/server";
import { type Caller, NOT_A_HOST } from "../contract";
import type { DeviceRegistry } from "../registry";

/**
 * A keyed call: a procedure of the peer protocol that a Device calls with
 * its Device key. This module holds what every one of them crosses, once:
 *
 * - `admission`: the key becomes a `Caller`, or the call is refused. The
 *   procedure's meta names the permission the key needs. No key is
 *   UNAUTHORIZED, a key without the permission FORBIDDEN. Then this
 *   computer must be a Host (else the refusal `NOT_A_HOST`: the Device
 *   keeps its key and tries later), and the key's Device must be paired
 *   here, with access, as the key's Person's own (else UNAUTHORIZED: pair
 *   it again). The Caller reads its Person's role in a Space once per
 *   call, and refuses in the Device's codes (`may`).
 * - `readable`: every error of a keyed call, in the codes older Devices
 *   know. An ORPCError passes on as it is. A `HostUnreachableError` is a
 *   HOST_UNREACHABLE (503). Any other `Refusal` is a BAD_REQUEST with its
 *   words and its kind beside them, a `not-found` included: an older
 *   Device reads every refusal so, a FORBIDDEN or an UNAUTHORIZED only
 *   ever means the key, and a NOT_FOUND means a Host too old to serve the
 *   procedure (`links/from-host.ts`). Any other error is a failure: an
 *   INTERNAL_SERVER_ERROR with plain words, and the details go to the
 *   Host's log.
 */

/** The words of a key this Host does not take: none, or a Device without access. */
const NO_ACCESS = "This device has no access here. Pair it again.";

/** The key of a keyed call, when there is one and it holds `need`. Else the Device's error. */
function requireKey(
	key: DeviceKeyAccess | null,
	need: DeviceKeyPermission | undefined,
): DeviceKeyAccess {
	if (!key) throw new ORPCError("UNAUTHORIZED", { message: NO_ACCESS });
	if (!need || !key.permissions[need]?.length) {
		throw new ORPCError("FORBIDDEN", {
			message: "This device may not do this here.",
		});
	}
	return key;
}

/** This Host's admission of keyed calls: `Devices.admit`. */
export function admission(deps: {
	db: Database;
	registry: Pick<DeviceRegistry, "get">;
	/** "Be a Host" is on now. */
	isHost(): boolean;
}): (
	key: DeviceKeyAccess | null,
	need: DeviceKeyPermission | undefined,
) => Promise<Caller> {
	return async (sent, need) => {
		const key = requireKey(sent, need);
		if (!deps.isHost()) throw new Refusal("unavailable", NOT_A_HOST);
		const paired = await deps.registry.get(key.deviceId);
		if (
			!paired ||
			paired.revokedAt !== null ||
			paired.ownerId !== key.personId
		) {
			throw new ORPCError("UNAUTHORIZED", { message: NO_ACCESS });
		}
		return caller(deps.db, key, {
			name: paired.name,
			homeHost: paired.homeHost,
		});
	};
}

/** The key as a Caller: its Person's roles from the member rows, each Space's read once. */
function caller(
	db: Database,
	key: DeviceKeyAccess,
	device: Caller["device"],
): Caller {
	const roles = new Map<string, Promise<Role | null>>();
	const role = (spaceId: string) => {
		let read = roles.get(spaceId);
		if (!read) {
			read = roleIn(db, key.personId, spaceId);
			roles.set(spaceId, read);
		}
		return read;
	};
	return {
		...key,
		device,
		spaces: async () => (await spacesOf(db, key.personId)).map((s) => s.id),
		roleIn: role,
		member: async (spaceId) => (await role(spaceId)) !== null,
		async may(spaceId, need, words) {
			const found = await role(spaceId);
			if (!found || !roleAllows(found, need)) forbidden(words);
		},
	};
}

/** The refusal of a call the Device may not make: FORBIDDEN, with the role refusal's words unless given. */
function forbidden(words: string = ROLE_REFUSAL.message): never {
	throw new ORPCError("FORBIDDEN", { message: words });
}

/**
 * The error a Device gets for `error`, thrown by the procedure at `path`,
 * in the codes older Devices know (see above).
 */
export function readable(
	error: unknown,
	path: readonly string[],
): ORPCError<string, unknown> {
	if (error instanceof ORPCError) return error;
	if (error instanceof HostUnreachableError) {
		return new ORPCError("HOST_UNREACHABLE", {
			status: 503,
			message: error.message,
			cause: error,
		});
	}
	if (error instanceof Refusal) {
		return new ORPCError("BAD_REQUEST", {
			message: error.message,
			data: { kind: error.kind },
			cause: error,
		});
	}
	console.error(`[host] ${path.join(".")} failed:`, error);
	return new ORPCError("INTERNAL_SERVER_ERROR", {
		message: FAILURE_MESSAGE,
		cause: error,
	});
}
