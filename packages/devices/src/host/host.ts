import {
	type Auth,
	approvePairing,
	bearerDeviceKey,
	createDeviceKeys,
	type DeviceKeyAccess,
	denyPairing,
	normalizeUserCode,
	redeemPairing,
	reviewPairing,
	type SyncDeviceKey,
	spacesOf,
	startPairing,
} from "@nightshift/auth";
import type { Database } from "@nightshift/db";
import type { SettingsStore } from "@nightshift/engine";
import type { HostHello, PairingRedeemed, PairingStart } from "../links";
import type { DeviceRegistry } from "../registry";
import type { PairingReviewView } from "./types";

/**
 * This computer as a Host: it serves pairing, gives a paired Device its
 * key, accepts the Device's link (oRPC and the relay) with that key, keeps
 * the Device online while its link answers, and removes its access on
 * request. All of it only while "Be a Host" is on.
 */
export type Host = ReturnType<typeof createHost>;

export const NOT_A_HOST =
	"This computer does not accept devices. Turn on Be a Host on its Devices page.";

/** A joining Device, as it introduced itself when it asked for a code. */
type Pending = {
	deviceId: string;
	name: string;
	platform: string;
	userCode: string;
	expiresAt: number;
};

export function createHost(deps: {
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
}) {
	const { auth, registry, settings } = deps;
	const keys = createDeviceKeys({
		auth,
		db: deps.db,
		idleDays: () => settings.current().deviceKeyIdleDays,
	});
	/** By device code. Kept in memory: a pairing outlives no Host restart. */
	const pending = new Map<string, Pending>();

	const isHost = () => settings.current().host;
	function requireHost() {
		if (!isHost()) throw new Error(NOT_A_HOST);
	}
	function pendingByUserCode(userCode: string): Pending | undefined {
		const code = normalizeUserCode(userCode);
		for (const p of pending.values()) if (p.userCode === code) return p;
		return undefined;
	}
	/** This Host as Devices know it. */
	function who(): HostHello["host"] {
		return {
			id: deps.self.id,
			name: deps.self.name,
			addresses: settings.current().hostAddresses,
		};
	}
	function prune() {
		const now = Date.now();
		for (const [code, p] of pending)
			if (p.expiresAt < now) pending.delete(code);
	}

	return {
		isHost,
		registry,

		/** The Device key of a request (`Authorization: Bearer`), resolved. */
		async keyOf(headers: Headers): Promise<DeviceKeyAccess | null> {
			const key = bearerDeviceKey(headers);
			return key ? keys.verify(key) : null;
		},

		/** A Device key as the relay checks it: with `sync`, of a Device with access. */
		async syncKey(token: string): Promise<SyncDeviceKey | null> {
			if (!isHost()) return null;
			const access = await keys.verify(token, "sync");
			if (!access) return null;
			const paired = await registry.get(access.deviceId);
			if (!paired || paired.revokedAt) return null;
			return {
				deviceId: access.deviceId,
				personId: access.personId,
				home: paired.homeHost !== null,
			};
		},

		async startPairing(input: {
			deviceId: string;
			name: string;
			platform: string;
		}): Promise<PairingStart> {
			requireHost();
			if (input.deviceId === deps.self.id) {
				throw new Error("A computer cannot pair with itself.");
			}
			prune();
			const code = await startPairing(auth, input.deviceId);
			pending.set(code.deviceCode, {
				...input,
				userCode: code.userCode,
				expiresAt: Date.now() + code.expiresIn * 1000,
			});
			const page = new URL(deps.devicesPage);
			const complete = new URL(page);
			complete.searchParams.set("pair", code.userCode);
			return {
				...code,
				verificationUri: page.toString(),
				verificationUriComplete: complete.toString(),
				fingerprint: deps.fingerprint,
			};
		},

		async redeemPairing(input: {
			deviceCode: string;
			deviceId: string;
			home: boolean;
			address: string;
		}): Promise<PairingRedeemed> {
			requireHost();
			const answer = await redeemPairing(auth, input);
			if (answer.status !== "approved") {
				if (answer.status === "denied" || answer.status === "expired") {
					pending.delete(input.deviceCode);
				}
				return { status: answer.status };
			}
			const asked = pending.get(input.deviceCode);
			pending.delete(input.deviceCode);
			const paired = await registry.join({
				id: input.deviceId,
				name: asked?.name ?? "Device",
				platform: asked?.platform ?? "unknown",
				ownerId: answer.personId,
				homeHost: input.home ? input.address : null,
			});
			const { key } = await keys.issue({
				personId: answer.personId,
				deviceId: paired.id,
				deviceName: paired.name,
			});
			return {
				status: "joined",
				key,
				personId: answer.personId,
				host: who(),
			};
		},

		async review(
			headers: Headers,
			userCode: string,
		): Promise<PairingReviewView> {
			requireHost();
			const review = await reviewPairing(auth, headers, userCode);
			const asked = pendingByUserCode(review.userCode);
			return {
				userCode: review.userCode,
				status: review.status,
				device: {
					id: review.deviceId,
					name: asked?.name ?? null,
					platform: asked?.platform ?? null,
				},
				fingerprint: deps.fingerprint,
			};
		},

		async approve(headers: Headers, userCode: string) {
			requireHost();
			await approvePairing(auth, headers, userCode);
		},

		async deny(headers: Headers, userCode: string) {
			requireHost();
			await denyPairing(auth, headers, userCode);
		},

		/** The Person's own Device only. Its key goes, then its connections. */
		async revoke(personId: string, deviceId: string) {
			const paired = await registry.get(deviceId);
			if (!paired || paired.ownerId !== personId) {
				throw new Error("This device is not one of yours here.");
			}
			await keys.revoke(deviceId);
			await registry.revoke(deviceId);
			deps.disconnect(deviceId);
		},

		/** A paired Device's link answered: it is online. */
		async hello(key: DeviceKeyAccess): Promise<HostHello> {
			// Not a refusal: the Device keeps its key and tries again later.
			requireHost();
			const paired = await registry.get(key.deviceId);
			if (!paired || paired.revokedAt) {
				throw new Error("This device has no access here. Pair it again.");
			}
			await registry.seen(key.deviceId);
			return {
				host: who(),
				deviceId: key.deviceId,
				personId: key.personId,
				// What the Device takes part in here: its owner's Spaces.
				spaces: await spacesOf(deps.db, key.personId),
			};
		},
	};
}
