import type {
	DeviceKeyAccess,
	DeviceKeyPermission,
	Role,
} from "@nightshift/auth";
import { type OtherVersion, Refusal } from "@nightshift/refusal";
import type { PairedDevice } from "../../../registry";
import type {
	CloneRows,
	DeviceKeys,
	Disconnect,
	HostSettings,
	KeyedCallCodes,
	Pairings,
	PersonSpaces,
	Registry,
	SpaceRoles,
} from "../../application/ports";
import { createDeviceVersions } from "../../domain/host";
import type { PairingAnswer, PairingCode } from "../../domain/pairing";
import { createPendingPairings } from "../../domain/pending";
import { NO_ACCESS, NO_PERMISSION } from "../../domain/words";

/**
 * The in-memory adapters of the ports another slice or package fills,
 * and `inMemoryHostPorts`, which gives a use-case test every port at once.
 * Test code: production code never imports this file.
 */

class CodedError extends Error {
	readonly code: string;
	constructor(code: string, message: string) {
		super(message);
		this.code = code;
	}
}

/** Pairing codes a test starts, reviews and redeems. */
export function inMemoryPairings() {
	const codes = new Map<
		string,
		{
			deviceId: string;
			userCode: string;
			personId: string | null;
			status: "pending" | "approved" | "denied";
		}
	>();
	let n = 0;
	const twin = {
		codes,
		async startPairing(deviceId: string): Promise<PairingCode> {
			n += 1;
			const deviceCode = `dc-${n}`;
			const userCode = `UC${n}`;
			codes.set(deviceCode, {
				deviceId,
				userCode,
				personId: null,
				status: "pending",
			});
			return { deviceCode, userCode, expiresIn: 900, interval: 0 };
		},
		async redeemPairing(input: {
			deviceCode: string;
			deviceId: string;
		}): Promise<PairingAnswer> {
			const found = codes.get(input.deviceCode);
			if (!found)
				throw new Refusal(
					"invalid",
					"This pairing code is not valid. Start the pairing again.",
				);
			if (found.status === "denied") return { status: "denied" };
			if (found.status === "pending" || !found.personId) {
				return { status: "pending" };
			}
			return { status: "approved", personId: found.personId };
		},
		async reviewPairing(_headers: Headers, userCode: string) {
			for (const row of codes.values()) {
				if (row.userCode === userCode) {
					return {
						userCode,
						status: row.status,
						deviceId: row.deviceId,
					};
				}
			}
			throw new Refusal(
				"not-found",
				"No device waits with this code. Check the code and try again.",
			);
		},
		async approvePairing(_headers: Headers, userCode: string) {
			for (const row of codes.values()) {
				if (row.userCode === userCode) {
					row.status = "approved";
					row.personId = row.personId ?? "person-ada";
					return;
				}
			}
		},
		async denyPairing(_headers: Headers, userCode: string) {
			for (const row of codes.values()) {
				if (row.userCode === userCode) {
					row.status = "denied";
					return;
				}
			}
		},
		approveAs(deviceCode: string, personId: string) {
			const row = codes.get(deviceCode);
			if (row) {
				row.status = "approved";
				row.personId = personId;
			}
		},
	};
	return twin satisfies Pairings & {
		codes: typeof codes;
		approveAs: (deviceCode: string, personId: string) => void;
	};
}

/** Device keys a test issues and revokes. */
export function inMemoryDeviceKeys() {
	const issued: { personId: string; deviceId: string; deviceName: string }[] =
		[];
	const revoked: string[] = [];
	const access = new Map<string, DeviceKeyAccess>();
	const twin = {
		issued,
		revoked,
		access,
		async issue(input: {
			personId: string;
			deviceId: string;
			deviceName: string;
		}) {
			issued.push(input);
			return { key: `key-${input.deviceId}`, keyId: `id-${input.deviceId}` };
		},
		async verify(key: string, need?: DeviceKeyPermission) {
			return access.get(`${key}:${need ?? ""}`) ?? access.get(key) ?? null;
		},
		async revoke(deviceId: string) {
			revoked.push(deviceId);
		},
	};
	return twin satisfies DeviceKeys & {
		issued: typeof issued;
		revoked: string[];
		access: Map<string, DeviceKeyAccess>;
	};
}

function paired(id: string, fields: Partial<PairedDevice> = {}): PairedDevice {
	return {
		id,
		name: id,
		platform: "test",
		ownerId: "person-ada",
		homeHost: "https://studio.invalid",
		lastSeenAt: null,
		online: false,
		pairedAt: 0,
		revokedAt: null,
		...fields,
	};
}

/** Paired Devices a test lists, joins and forgets. */
export function inMemoryRegistry() {
	const rows = new Map<string, PairedDevice>();
	const seenIds: string[] = [];
	let selfOwner: string | null = null;
	const walkerSeqs = new Map<string, number>();
	const twin = {
		rows,
		seenIds,
		setSelfOwner(personId: string | null) {
			selfOwner = personId;
		},
		setWalkerSeq(id: string, seq: number) {
			walkerSeqs.set(id, seq);
		},
		put(row: PairedDevice) {
			rows.set(row.id, row);
		},
		async get(id: string) {
			return rows.get(id) ?? null;
		},
		async list(ownerId: string) {
			return [...rows.values()].filter((d) => d.ownerId === ownerId);
		},
		async join(input: {
			id: string;
			name: string;
			platform: string;
			ownerId: string;
			homeHost: string | null;
			machine?: string;
		}) {
			const row = paired(input.id, {
				name: input.name,
				platform: input.platform,
				ownerId: input.ownerId,
				homeHost: input.homeHost,
				revokedAt: null,
			});
			rows.set(row.id, row);
			return row;
		},
		async sameMachine(ownerId: string, _machine: string, exceptId: string) {
			return (
				[...rows.values()].find(
					(d) => d.ownerId === ownerId && d.id !== exceptId,
				) ?? null
			);
		},
		async lastWalkerSeq(deviceId: string) {
			return walkerSeqs.get(deviceId) ?? 0;
		},
		async seen(id: string) {
			seenIds.push(id);
			const row = rows.get(id);
			if (row) rows.set(id, { ...row, online: true, lastSeenAt: 1 });
		},
		async revoke(id: string) {
			const row = rows.get(id);
			if (row) rows.set(id, { ...row, revokedAt: 1, online: false });
		},
		async forget(id: string) {
			rows.delete(id);
		},
		async selfOwnerId() {
			return selfOwner;
		},
		async keptDocumentOwner() {
			return null;
		},
	};
	return twin satisfies Registry & {
		rows: Map<string, PairedDevice>;
		seenIds: string[];
		setSelfOwner: (personId: string | null) => void;
		setWalkerSeq: (id: string, seq: number) => void;
		put: (row: PairedDevice) => void;
	};
}

/** Spaces and Host admin of a test Person. */
export function inMemoryPersonSpaces() {
	const spaces: {
		id: string;
		name: string;
		personal: boolean;
		role: Role;
	}[] = [];
	const admins = new Set<string>();
	const twin = {
		spaces,
		admins,
		async of() {
			return [...spaces];
		},
		async isHostAdmin(personId: string) {
			return admins.has(personId);
		},
	};
	return twin satisfies PersonSpaces & {
		spaces: typeof spaces;
		admins: Set<string>;
	};
}

/** Roles a keyed call reads. */
export function inMemorySpaceRoles() {
	const roles = new Map<string, Role | null>();
	const twin = {
		roles,
		async roleIn(_personId: string, spaceId: string) {
			return roles.has(spaceId) ? (roles.get(spaceId) ?? null) : null;
		},
		roleAllows(role: Role, _need: { run?: string[] }) {
			return role !== "viewer";
		},
	};
	return twin satisfies SpaceRoles & { roles: Map<string, Role | null> };
}

/** The Device codes a test records. */
export function inMemoryKeyedCallCodes() {
	const twin = {
		unauthorized(words: string): never {
			throw new CodedError("UNAUTHORIZED", words);
		},
		forbidden(words: string): never {
			throw new CodedError("FORBIDDEN", words);
		},
		otherVersion(device: OtherVersion): never {
			throw new CodedError("HOST_UNREACHABLE", device);
		},
	};
	return twin satisfies KeyedCallCodes;
}

/** "Be a Host" and its addresses. */
export function inMemoryHostSettings(enabled = true) {
	const twin = {
		enabled,
		isHost() {
			return twin.enabled;
		},
		hostAddresses() {
			return ["https://studio.invalid"];
		},
	};
	return twin satisfies HostSettings & { enabled: boolean };
}

/** Disconnects a test records. */
export function inMemoryDisconnect() {
	const ids: string[] = [];
	const twin = {
		ids,
		disconnect(deviceId: string) {
			ids.push(deviceId);
		},
	};
	return twin satisfies Disconnect & { ids: string[] };
}

/** Forgotten clones a test records. */
export function inMemoryCloneRows() {
	const ids: string[] = [];
	const twin = {
		ids,
		async forget(deviceId: string) {
			ids.push(deviceId);
		},
	};
	return twin satisfies CloneRows & { ids: string[] };
}

/** Every port of host, for a use-case test. */
export function inMemoryHostPorts() {
	return {
		pairings: inMemoryPairings(),
		keys: inMemoryDeviceKeys(),
		registry: inMemoryRegistry(),
		spaces: inMemoryPersonSpaces(),
		roles: inMemorySpaceRoles(),
		codes: inMemoryKeyedCallCodes(),
		versions: createDeviceVersions(),
		settings: inMemoryHostSettings(),
		relay: inMemoryDisconnect(),
		clones: inMemoryCloneRows(),
		pending: createPendingPairings(),
		self: { id: "host-a", name: "Studio" },
		devicesPage: "https://studio.invalid/devices",
		fingerprint: null as string | null,
		now: () => 1_000,
		bearerOf: (_headers: Headers) => null as string | null,
	};
}

export { NO_ACCESS, NO_PERMISSION };
