import { HOST_ADMIN } from "../domain/members";
import type { PersonStore } from "./ports";

export type IsHostAdminPorts = {
	personStore: Pick<PersonStore, "roleOf">;
};

/** Which Person. */
export type IsHostAdmin = { personId: string };

/** Whether the Person is the Host admin. */
export const isHostAdmin =
	(ports: IsHostAdminPorts) =>
	async (request: IsHostAdmin): Promise<boolean> =>
		(await ports.personStore.roleOf(request.personId)) === HOST_ADMIN;
