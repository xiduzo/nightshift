import type { Database } from "@nightshift/db";
import { type Access, type SyncSetup, wireAccess } from "../access";
import { type HostPolicy, OPEN_HOST } from "../access/host-access";
import { wireLocalSession } from "../access/local-session";
import { wireLogin } from "../access/login";
import type { Auth } from "../auth";
import { wireDeviceKeys } from "../devices/device-keys";
import { wirePairing } from "../devices/pairing";
import { wireSpaces } from "../spaces";
import type { OwnedDevice } from "../spaces/personal/domain/personal-space";

/**
 * Bound auth wires for tests: the same composition roots production uses,
 * without the deleted per-call facades. Only `@nightshift/auth/testing`
 * exports these.
 */

/** A Device that names nobody and keeps no owner. */
export const UNOWNED: OwnedDevice = { ownerId: null, setOwner: async () => {} };

export function testSpaces(db: Database) {
	return wireSpaces({ db });
}

export function testLocalPerson(db: Database) {
	return testSpaces(db).personal.findLocalPerson({ self: UNOWNED });
}

export function testAccess(auth: Auth, db: Database): Access {
	return wireAccess({ auth, db });
}

export function testLocalSession(auth: Auth, db: Database, personId: string) {
	return wireLocalSession({ auth, db, personId });
}

export function testLogin(auth: Auth, db: Database) {
	return wireLogin({ auth, db });
}

export function testDeviceKeys(auth: Auth, db: Database) {
	return wireDeviceKeys({ auth, db });
}

export function testPairing(auth: Auth) {
	return wirePairing({ auth });
}

export function testRequestAccess(
	auth: Auth,
	db: Database,
	headers: Headers,
	local: ReturnType<typeof wireLocalSession> | null,
	policy: HostPolicy = OPEN_HOST,
) {
	return testAccess(auth, db).openRequest({ headers, local, policy });
}

export function testAuthEndpointAccess(
	auth: Auth,
	db: Database,
	headers: Headers,
	local: ReturnType<typeof wireLocalSession> | null,
	policy: HostPolicy = OPEN_HOST,
) {
	return testAccess(auth, db).openAuthEndpoint({ headers, local, policy });
}

export function testDocumentAccess(auth: Auth, db: Database, setup: SyncSetup) {
	return testAccess(auth, db).authorizeDocuments(setup);
}
