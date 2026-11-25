import type { DeviceKeyAccess, DeviceKeyPermission } from "@nightshift/auth";
import {
	type Auth,
	bearerDeviceKey,
	ROLE_REFUSAL,
	roleAllows,
	wireDeviceKeys,
	wirePairing,
	wireSpaces,
} from "@nightshift/auth";
import type { Database } from "@nightshift/db";
import type { SettingsStore } from "@nightshift/engine/settings";
import { deviceVersionWords } from "@nightshift/refusal";
import { now as timeNow } from "@nightshift/time";
import { ORPCError } from "@orpc/server";
import type { DeviceRegistry } from "../registry";
import { admitKeyedCall } from "./application/admit-keyed-call";
import { answerHello } from "./application/answer-hello";
import { approvePairing } from "./application/approve-pairing";
import { denyPairing } from "./application/deny-pairing";
import { forgetDevice } from "./application/forget-device";
import type { HostSettings, KeyedCallCodes } from "./application/ports";
import { readBearerKey } from "./application/read-bearer-key";
import { readSyncKey } from "./application/read-sync-key";
import { redeemPairing } from "./application/redeem-pairing";
import { reviewPairing } from "./application/review-pairing";
import { revokeDevice } from "./application/revoke-device";
import { startPairing } from "./application/start-pairing";
import { createDeviceVersions } from "./domain/host";
import { createPendingPairings, type PendingPairings } from "./domain/pending";

/**
 * The wiring of host: the one place that binds pairing, Device keys,
 * presence and keyed-call admission to their ports.
 */

/** What the package gives host: auth, the registry, this computer, the relay. */
export type HostDeps = {
	auth: Auth;
	db: Database;
	registry: DeviceRegistry;
	settings: SettingsStore;
	self: { id: string; name: string };
	/** The UI's Devices page, where a Person enters a code. */
	devicesPage: string;
	/** The SHA-256 fingerprint of the certificate this daemon serves itself. */
	fingerprint: string | null;
	/** Ends the Device's open connections to the relay. */
	disconnect(deviceId: string): void;
	/** Removes a Device's Clones from the Space documents this Host keeps. */
	forgetClones(deviceId: string): Promise<void>;
	/** The pairings in progress of the Host before a reload. Default: none. */
	pending?: PendingPairings;
	now?: () => number;
};

const keyedCallCodes = (
	hostId: string,
	named: { hostId: string } | null,
): KeyedCallCodes => ({
	unauthorized: (words) => {
		throw refusal("UNAUTHORIZED", words, named);
	},
	forbidden: (words) => {
		throw refusal("FORBIDDEN", words, named);
	},
	otherVersion: (device) => {
		throw new ORPCError("HOST_UNREACHABLE", {
			status: 503,
			message: deviceVersionWords(device),
			data: { device, hostId },
		});
	},
});

const refusal = (
	code: "UNAUTHORIZED" | "FORBIDDEN",
	message: string,
	named: { hostId: string } | null,
) => new ORPCError(code, { message, ...(named ? { data: named } : {}) });

/**
 * This computer as a Host: pairing, Device keys, presence, and the
 * admission of a keyed call.
 */
export type Host = ReturnType<typeof wireHost>;

export function wireHost(deps: HostDeps) {
	const pending = createPendingPairings(deps.pending);
	const now = deps.now ?? timeNow;
	const versions = createDeviceVersions();
	const keys = wireDeviceKeys({
		auth: deps.auth,
		db: deps.db,
		idleDays: () => deps.settings.current().deviceKeyIdleDays,
	});
	const pairing = wirePairing({ auth: deps.auth });
	const spacesBound = wireSpaces({ db: deps.db });
	const settings: HostSettings = {
		isHost: () => deps.settings.current().host,
		hostAddresses: () => deps.settings.current().hostAddresses,
	};
	const spaces = {
		of: (personId: string) => spacesBound.listSpaces({ personId }),
		isHostAdmin: (personId: string) =>
			spacesBound.members.isHostAdmin({ personId }),
	};
	const roles = {
		roleIn: (personId: string, spaceId: string) =>
			spacesBound.findRole({ personId, spaceId }),
		roleAllows,
		refusalWords: () => ROLE_REFUSAL.message,
	};
	const pairingPorts = {
		pairings: {
			startPairing: (deviceId: string) => pairing.startPairing({ deviceId }),
			redeemPairing: (input: { deviceCode: string; deviceId: string }) =>
				pairing.redeemPairing(input),
			reviewPairing: (headers: Headers, userCode: string) =>
				pairing.reviewPairing({ headers, userCode }),
			approvePairing: (headers: Headers, userCode: string) =>
				pairing.approvePairing({ headers, userCode }),
			denyPairing: (headers: Headers, userCode: string) =>
				pairing.denyPairing({ headers, userCode }),
		},
		keys,
		registry: deps.registry,
		spaces,
		settings,
		pending,
		self: deps.self,
		devicesPage: deps.devicesPage,
		fingerprint: deps.fingerprint,
		now,
	};
	return {
		isHost: settings.isHost,
		registry: deps.registry,
		admit: (
			key: DeviceKeyAccess | null,
			need: DeviceKeyPermission | undefined,
			version: number | null,
			askedHost: string | null,
		) =>
			admitKeyedCall({
				registry: deps.registry,
				settings,
				spaces,
				roles,
				codes: keyedCallCodes(
					deps.self.id,
					// Its own id, and only to a call that means this Host: a Host
					// tells no one else which Host it is.
					askedHost === deps.self.id ? { hostId: deps.self.id } : null,
				),
				versions,
			})({ key, need, version }),
		/** How the version of a Device's last call compares with this Host's. Null: the same, or it did not call. */
		versionOf: (deviceId: string) => versions.of(deviceId),
		keyOf: readBearerKey({ keys, bearerOf: bearerDeviceKey }),
		syncKey: readSyncKey({
			keys,
			registry: deps.registry,
			settings,
		}),
		startPairing: startPairing(pairingPorts),
		redeemPairing: redeemPairing(pairingPorts),
		review: (headers: Headers, userCode: string, personId: string) =>
			reviewPairing(pairingPorts)({ headers, userCode, personId }),
		approve: (headers: Headers, userCode: string) =>
			approvePairing(pairingPorts)({ headers, userCode }),
		deny: (headers: Headers, userCode: string) =>
			denyPairing(pairingPorts)({ headers, userCode }),
		revoke: (personId: string, deviceId: string) =>
			revokeDevice({
				registry: deps.registry,
				keys,
				relay: { disconnect: deps.disconnect },
			})({ personId, deviceId }),
		forget: (personId: string, deviceId: string) =>
			forgetDevice({
				registry: deps.registry,
				clones: { forget: deps.forgetClones },
			})({ personId, deviceId }),
		hello: answerHello({
			registry: deps.registry,
			spaces,
			settings,
			self: deps.self,
		}),
	};
}
