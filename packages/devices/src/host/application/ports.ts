import type {
	DeviceKeyAccess,
	DeviceKeyPermission,
	Permissions,
	Role,
} from "@nightshift/auth";
import type { DeviceRegistry } from "../../registry";
import type {
	PairingAnswer,
	PairingCode,
	PairingReview,
} from "../domain/pairing";

/**
 * The driven ports of host. Another slice or package fills each one
 * (`@filledBy`). Twins live in `adapters/out/in-memory-neighbours.ts`.
 * `Registry` is a `Pick` of `DeviceRegistry` (DR), including
 * `lastWalkerSeq` (the plan's WalkerCounts, now on the registry).
 */

/**
 * The pairing codes of this Host (Better Auth's device authorization).
 * @filledBy auth
 */
export type Pairings = {
	startPairing(deviceId: string): Promise<PairingCode>;
	redeemPairing(input: {
		deviceCode: string;
		deviceId: string;
	}): Promise<PairingAnswer>;
	reviewPairing(headers: Headers, userCode: string): Promise<PairingReview>;
	approvePairing(headers: Headers, userCode: string): Promise<void>;
	denyPairing(headers: Headers, userCode: string): Promise<void>;
};

/**
 * The Device keys of this Host: issue, verify, revoke.
 * @filledBy auth
 */
export type DeviceKeys = {
	issue(input: {
		personId: string;
		deviceId: string;
		deviceName: string;
	}): Promise<{ key: string; keyId: string }>;
	verify(
		key: string,
		need?: DeviceKeyPermission,
	): Promise<DeviceKeyAccess | null>;
	revoke(deviceId: string): Promise<void>;
};

/**
 * The Devices paired with this Host, and this computer's own row.
 * @filledBy devices
 */
export type Registry = Pick<
	DeviceRegistry,
	| "get"
	| "list"
	| "join"
	| "sameMachine"
	| "lastWalkerSeq"
	| "seen"
	| "revoke"
	| "forget"
	| "selfOwnerId"
	| "keptDocumentOwner"
>;

/**
 * The Spaces a Person is a Member of, and whether they are the Host admin.
 * @filledBy auth
 */
export type PersonSpaces = {
	of(
		personId: string,
	): Promise<{ id: string; name: string; personal: boolean; role: Role }[]>;
	isHostAdmin(personId: string): Promise<boolean>;
};

/**
 * A Person's role in a Space, as a keyed call reads it.
 * @filledBy auth
 */
export type SpaceRoles = {
	roleIn(personId: string, spaceId: string): Promise<Role | null>;
	roleAllows(role: Role, need: Permissions): boolean;
};

/**
 * The codes a Device reads for a keyed call that this Host does not take.
 * FORBIDDEN and UNAUTHORIZED only ever mean the key.
 * @filledBy devices/wire
 */
export type KeyedCallCodes = {
	unauthorized(words: string): never;
	forbidden(words: string): never;
};

/**
 * Whether "Be a Host" is on, and the addresses Devices try.
 * @filledBy engine/device-config
 */
export type HostSettings = {
	isHost(): boolean;
	hostAddresses(): string[];
};

/**
 * Ends the Device's open connections to the relay.
 * @filledBy daemon
 */
export type Disconnect = {
	disconnect(deviceId: string): void;
};

/**
 * Removes a Device's Clones from the Space documents this Host keeps.
 * @filledBy engine/wire
 */
export type CloneRows = {
	forget(deviceId: string): Promise<void>;
};
