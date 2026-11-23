import { Refusal } from "@nightshift/refusal";
import { NOT_YOURS_HERE, REMOVE_ACCESS_FIRST } from "../domain/words";
import type { CloneRows, Registry } from "./ports";

export type ForgetDevicePorts = {
	registry: Pick<Registry, "get" | "forget">;
	clones: CloneRows;
};

export type ForgetDevice = { personId: string; deviceId: string };

/**
 * The Person's own Device, whose access is gone: it leaves the list
 * for good, with its Clones. To use it again, pair it again.
 */
export const forgetDevice =
	(ports: ForgetDevicePorts) =>
	async (request: ForgetDevice): Promise<void> => {
		const paired = await ports.registry.get(request.deviceId);
		if (!paired || paired.ownerId !== request.personId) {
			throw new Refusal("forbidden", NOT_YOURS_HERE);
		}
		if (paired.revokedAt === null) {
			throw new Refusal("conflict", REMOVE_ACCESS_FIRST);
		}
		await ports.clones.forget(request.deviceId);
		await ports.registry.forget(request.deviceId);
	};
