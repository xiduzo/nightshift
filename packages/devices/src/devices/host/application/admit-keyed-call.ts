import type {
	DeviceKeyAccess,
	DeviceKeyPermission,
	Permissions,
	Role,
} from "@nightshift/auth";
import { otherVersion } from "@nightshift/refusal";
import type { Caller } from "../../../contract";
import type { DeviceVersions } from "../domain/host";
import { requireHost } from "../domain/host";
import { NO_ACCESS, NO_PERMISSION } from "../domain/words";
import type {
	HostSettings,
	KeyedCallCodes,
	PersonSpaces,
	Registry,
	SpaceRoles,
} from "./ports";

export type AdmitKeyedCallPorts = {
	registry: Pick<Registry, "get">;
	settings: Pick<HostSettings, "isHost">;
	spaces: Pick<PersonSpaces, "of">;
	roles: SpaceRoles;
	codes: KeyedCallCodes;
	versions: DeviceVersions;
};

export type AdmitKeyedCall = {
	key: DeviceKeyAccess | null;
	need: DeviceKeyPermission | undefined;
	/** The version the call says. Null: none. */
	version: number | null;
};

/**
 * Admits a keyed call once: the key, when there is one that holds
 * `need`, of a Device paired here with access, as its Person's own,
 * on a computer that is a Host now. Then, and only then, the version: a
 * Device of another one waits for an update (ADR 45).
 */
export const admitKeyedCall =
	(ports: AdmitKeyedCallPorts) =>
	async (request: AdmitKeyedCall): Promise<Caller> => {
		const key = requireKey(ports.codes, request.key, request.need);
		requireHost(ports.settings.isHost());
		const paired = await ports.registry.get(key.deviceId);
		if (
			!paired ||
			paired.revokedAt !== null ||
			paired.ownerId !== key.personId
		) {
			ports.codes.unauthorized(NO_ACCESS);
		}
		const other = otherVersion(request.version);
		ports.versions.said(key.deviceId, other);
		if (other) ports.codes.otherVersion(other);
		return callerOf(ports, key, {
			name: paired.name,
			homeHost: paired.homeHost,
		});
	};

function requireKey(
	codes: KeyedCallCodes,
	key: DeviceKeyAccess | null,
	need: DeviceKeyPermission | undefined,
): DeviceKeyAccess {
	if (!key) codes.unauthorized(NO_ACCESS);
	if (!need || !key.permissions[need]?.length) {
		codes.forbidden(NO_PERMISSION);
	}
	return key;
}

function callerOf(
	ports: AdmitKeyedCallPorts,
	key: DeviceKeyAccess,
	device: Caller["device"],
): Caller {
	const roles = new Map<string, Promise<Role | null>>();
	const role = (spaceId: string) => {
		let read = roles.get(spaceId);
		if (!read) {
			read = ports.roles.roleIn(key.personId, spaceId);
			roles.set(spaceId, read);
		}
		return read;
	};
	return {
		...key,
		device,
		spaces: async () => (await ports.spaces.of(key.personId)).map((s) => s.id),
		roleIn: role,
		member: async (spaceId) => (await role(spaceId)) !== null,
		async may(spaceId, need: Permissions, words) {
			const found = await role(spaceId);
			if (!found || !ports.roles.roleAllows(found, need)) {
				ports.codes.forbidden(words ?? ports.roles.refusalWords());
			}
		},
	};
}
