import type { Database } from "@nightshift/db";
import { type Access, type SyncSetup, wireAccess } from "../access";
import type { Auth } from "../auth";
import { wireDeviceKeys } from "../device-keys";
import { type HostPolicy, OPEN_HOST } from "../host-access";
import { wireLocalSession } from "../local-session";
import { wireLogin } from "../login";
import { wirePairing } from "../pairing";
import { wireSpaces } from "../spaces";
import { UNOWNED as unownedDevice } from "../spaces/personal/domain/personal-space";

/** This computer's Device with no owner yet (for `findLocalPerson`). */
export const UNOWNED = unownedDevice;

/**
 * Bound auth wires for tests: the same composition roots production uses,
 * without the deleted per-call facades. Only `@nightshift/auth/testing`
 * exports these.
 */

export function testSpaces(db: Database) {
	return wireSpaces({ db });
}

export function testLocalPerson(db: Database) {
	return testSpaces(db).personal.findLocalPerson({ self: unownedDevice });
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
