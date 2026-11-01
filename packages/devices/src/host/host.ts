import {
	type Auth,
	approvePairing,
	bearerDeviceKey,
	createDeviceKeys,
	type DeviceKeyAccess,
	denyPairing,
	isHostAdmin,
	normalizeUserCode,
	redeemPairing,
	reviewPairing,
	type SyncDeviceKey,
	spacesOf,
	startPairing,
} from "@nightshift/auth";
import type { Database } from "@nightshift/db";
import type { SettingsStore } from "@nightshift/engine/device-config";
import { Refusal } from "@nightshift/refusal";
import { now as timeNow } from "@nightshift/time";
import {
	type HostHello,
	NOT_A_HOST,
	type PairingRedeemed,
	type PairingStart,
} from "../contract";
import { type DeviceRegistry, selfOwnerId } from "../registry";
import type { PairingReviewView } from "./types";

/**
 * This computer as a Host: it serves pairing, gives a paired Device its
 * key, accepts the Device's link (oRPC and the relay) with that key, keeps
 * the Device online while its link answers, and removes its access on
 * request. All of it only while "Be a Host" is on.
 */
export type Host = ReturnType<typeof createHost>;

/** A joining Device, as it introduced itself when it asked for a code. */
type Pending = {
	deviceId: string;
	name: string;
	platform: string;
	/** It asks this Host to be its home Host. Undefined: an older Device did not say. */
	home?: boolean;
	userCode: string;
	expiresAt: number;
};

/**
 * The pairings in progress, by device code. In memory: a pairing outlives
 * no Host restart. A `bun --hot` reload hands them to the next Host, so a
 * Device that asked for a code before it still joins under its own name.
 */
export type PendingPairings = Map<string, Pending>;

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
	/** The pairings in progress of the Host before a reload. Default: none. */
	pending?: PendingPairings;
}) {
	const { auth, registry, settings } = deps;
	const keys = createDeviceKeys({
		auth,
		db: deps.db,
		idleDays: () => settings.current().deviceKeyIdleDays,
	});
	const pending: PendingPairings = deps.pending ?? new Map();

	const isHost = () => settings.current().host;
	function requireHost() {
		if (!isHost()) throw new Refusal("unavailable", NOT_A_HOST);
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
	/**
	 * The other Devices of a home Device's owner whose documents this Host
	 * keeps, and this Host when the owner owns it: the documents the Device
	 * reads (`documentAccess`). Never another Person's.
	 */
	async function ownDevices(
		key: DeviceKeyAccess,
	): Promise<NonNullable<HostHello["devices"]>> {
		const others = (await registry.list(key.personId)).filter(
			(d) =>
				d.id !== key.deviceId && d.revokedAt === null && d.homeHost !== null,
		);
		const host =
			(await selfOwnerId(deps.db)) === key.personId
				? [{ id: deps.self.id, name: deps.self.name }]
				: [];
		return [...host, ...others.map((d) => ({ id: d.id, name: d.name }))];
	}
	function prune() {
		const now = timeNow();
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
			home?: boolean;
		}): Promise<PairingStart> {
			requireHost();
			if (input.deviceId === deps.self.id) {
				throw new Refusal("invalid", "A computer cannot pair with itself.");
			}
			prune();
			const code = await startPairing(auth, input.deviceId);
			pending.set(code.deviceCode, {
				...input,
				userCode: code.userCode,
				expiresAt: timeNow() + code.expiresIn * 1000,
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
				hostAdmin: await isHostAdmin(deps.db, answer.personId),
			};
		},

		async review(
			headers: Headers,
			userCode: string,
			personId: string,
		): Promise<PairingReviewView> {
			requireHost();
			const review = await reviewPairing(auth, headers, userCode);
			const asked = pendingByUserCode(review.userCode);
			return {
				hostAdmin: await isHostAdmin(deps.db, personId),
				home: asked?.home ?? null,
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
				throw new Refusal("forbidden", "This device is not one of yours here.");
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
				throw new Refusal(
					"forbidden",
					"This device has no access here. Pair it again.",
				);
			}
			await registry.seen(key.deviceId);
			const spaces = await spacesOf(deps.db, key.personId);
			const home = paired.homeHost !== null;
			return {
				host: who(),
				deviceId: key.deviceId,
				personId: key.personId,
				// What the Device takes part in here: its owner's Spaces. A
				// personal Space stays with the owner's Home Host (ADR 1).
				spaces: home ? spaces : spaces.filter((space) => !space.personal),
				hostAdmin: await isHostAdmin(deps.db, key.personId),
				...(home ? { devices: await ownDevices(key) } : {}),
			};
		},
	};
}
