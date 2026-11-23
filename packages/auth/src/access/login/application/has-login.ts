import type { Credentials } from "./ports";

export type HasLoginPorts = {
	credentials: Pick<Credentials, "hasPassword">;
};

/** Whose login. */
export type HasLogin = { personId: string };

/** Whether the Person can sign in with an email and a password. */
export const hasLogin =
	(ports: HasLoginPorts) =>
	async (request: HasLogin): Promise<boolean> =>
		ports.credentials.hasPassword(request.personId);
