import type { ConnectionStore } from "@nightshift/engine/device-config";
import type { WorkRelay } from "../../../contract";

/**
 * The driven ports of the moves. Each is filled from outside the slice
 * (`@filledBy`): the composition passes it to `wireMoves`.
 */

/**
 * The Devices paired with this Host, as a move reads them: only what it
 * asks of one.
 * @filledBy devices/registry
 */
export type OtherDevices = {
	get(id: string): Promise<{
		id: string;
		name: string;
		ownerId: string | null;
		homeHost: string | null;
		revokedAt: number | null;
	} | null>;
};

/**
 * The Home Host's work hub: the Device with the value takes the secret
 * call over its own work stream.
 * @filledBy devices/work
 */
export type MoveWork = Pick<WorkRelay, "call" | "online">;

/**
 * This computer's own secrets, in its keychain: the moves it makes of a
 * value it has.
 * @filledBy engine/device-config
 */
export type OwnSecrets = Pick<
	ConnectionStore,
	"moveSecret" | "moveToProject" | "removeSecret"
>;
