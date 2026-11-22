import type { Auth, Session } from "../../../auth";
import type { SessionReader } from "../../application/ports";

/** `SessionReader` over Better Auth's `getSession`. `wireAccess` builds it. */
export function betterAuthSessionReader(auth: Auth): SessionReader<Session> {
	return {
		read: (headers) => auth.api.getSession({ headers }),
	};
}
