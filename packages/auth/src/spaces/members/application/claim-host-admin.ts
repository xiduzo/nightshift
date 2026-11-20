import { HOST_ADMIN } from "../domain/members";
import type { PersonStore } from "./ports";

export type ClaimHostAdminPorts = {
	personStore: Pick<PersonStore, "hasRole" | "setRole">;
};

/** Which Person. */
export type ClaimHostAdmin = { personId: string };

/** Makes the Person the Host admin when the Host has none: the first Person. */
export const claimHostAdmin =
	(ports: ClaimHostAdminPorts) =>
	async (request: ClaimHostAdmin): Promise<void> => {
		if (await ports.personStore.hasRole(HOST_ADMIN)) return;
		await ports.personStore.setRole(request.personId, HOST_ADMIN);
	};
