import type { Role } from "../../roles";
import { type InvitationStatus, invitationStatus } from "../domain/members";
import type { InvitationStore, PersonStore } from "./ports";

/** An invitation as the page that accepts it shows it, before anyone signs in. */
export type InvitationView = {
	id: string;
	spaceName: string;
	email: string;
	role: Role;
	inviterName: string;
	/** `expired`: pending, but past its time. */
	status: InvitationStatus;
	/** Whether a Person with this email exists on this Host: sign in, not sign up. */
	hasAccount: boolean;
};

/** An invitation as its store keeps it, with the names of its Space and its inviter. */
export type StoredInvitation = Omit<InvitationView, "status" | "hasAccount"> & {
	/** The organization plugin's status: pending, accepted, canceled or rejected. */
	status: string;
	expiresAt: number;
};

export type ViewInvitationPorts = {
	invitationStore: Pick<InvitationStore, "find">;
	personStore: Pick<PersonStore, "hasAccount">;
};

/** The invitation, by the id that is the secret of its link, and the time. */
export type ViewInvitation = { id: string; now: number };

/** The invitation of that id, as the page that accepts it shows it, or null. */
export const viewInvitation =
	(ports: ViewInvitationPorts) =>
	async (request: ViewInvitation): Promise<InvitationView | null> => {
		const found = await ports.invitationStore.find(request.id);
		if (!found) return null;
		const hasAccount = await ports.personStore.hasAccount(
			found.email.toLowerCase(),
		);
		return {
			id: found.id,
			spaceName: found.spaceName,
			email: found.email,
			role: found.role,
			inviterName: found.inviterName,
			status: invitationStatus(found, request.now),
			hasAccount,
		};
	};
