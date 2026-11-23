import { DAY_MS } from "@nightshift/time";
import { keyName, newKeyPermissions } from "../domain/device-keys";
import type { KeyIssuer } from "./ports";
import type { RevokeKeys } from "./revoke-keys";

export type IssueKeyPorts = {
	keyIssuer: KeyIssuer;
	/** How many days a key may go unused. Read on every issue. */
	idleDays: () => number;
	/** Deletes the Device's earlier keys (`revokeKeys`, bound by the wire). */
	revokeKeys: (request: RevokeKeys) => Promise<void>;
};

/** Which Device, of whom. */
export type IssueKey = {
	personId: string;
	deviceId: string;
	deviceName: string;
};

/**
 * A new key for the Device, bound to the Person. The Device's earlier keys
 * on this Host stop working. The key is returned once and never stored in
 * the clear.
 */
export const issueKey =
	(ports: IssueKeyPorts) =>
	async (request: IssueKey): Promise<{ key: string; keyId: string }> => {
		await ports.revokeKeys({ deviceId: request.deviceId });
		return ports.keyIssuer.create({
			personId: request.personId,
			name: keyName(request.deviceName),
			deviceId: request.deviceId,
			permissions: newKeyPermissions(),
			expiresIn: Math.round((ports.idleDays() * DAY_MS) / 1000),
		});
	};
