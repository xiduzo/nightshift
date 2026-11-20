import { INVITATION_NOT_VALID, INVITATION_ONLY } from "../domain/members";
import type { InvitationStore, PersonStore } from "./ports";

export type CheckSignUpPorts = {
	personStore: Pick<PersonStore, "hasAnyone">;
	invitationStore: Pick<InvitationStore, "isOpen">;
};

/** The body of the sign-up, as the client sent it, and the time. */
export type CheckSignUp = {
	body: { email?: unknown; invitationId?: unknown };
	now: number;
};

/**
 * Why an email and password sign-up is refused, or null when it may go
 * ahead: the Host's first Person always may. Anyone else needs a pending,
 * unexpired invitation of that email, named by `invitationId`.
 */
export const checkSignUp =
	(ports: CheckSignUpPorts) =>
	async (request: CheckSignUp): Promise<string | null> => {
		if (!(await ports.personStore.hasAnyone())) return null;
		const { body } = request;
		const email =
			typeof body.email === "string" ? body.email.toLowerCase() : "";
		const id = typeof body.invitationId === "string" ? body.invitationId : "";
		if (!id) return INVITATION_ONLY;
		const open = await ports.invitationStore.isOpen({
			id,
			email,
			now: request.now,
		});
		return open ? null : INVITATION_NOT_VALID;
	};
