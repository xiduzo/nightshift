import { HOST_ADMIN } from "../domain/members";
import type { PersonStore } from "./ports";

export type HasHostAdminPorts = {
	personStore: Pick<PersonStore, "hasRole">;
};

/** Whether the Host has a Host admin yet. */
export const hasHostAdmin =
	(ports: HasHostAdminPorts) => async (): Promise<boolean> =>
		ports.personStore.hasRole(HOST_ADMIN);
