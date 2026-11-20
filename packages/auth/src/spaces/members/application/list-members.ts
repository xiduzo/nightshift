import type { Role } from "../../roles";
import type { InvitationStore, MemberStore } from "./ports";

/** A Member of a Space, as the Members page lists them. */
export type SpaceMember = {
	/** The membership. */
	id: string;
	personId: string;
	name: string;
	email: string;
	role: Role;
	joinedAt: number;
};

/** A pending invitation of a Space. */
export type PendingInvitation = {
	id: string;
	email: string;
	role: Role;
	inviterName: string;
	expiresAt: number;
};

export type ListMembersPorts = {
	memberStore: Pick<MemberStore, "membersOf">;
	invitationStore: Pick<InvitationStore, "pendingOf">;
};

/** Which Space, and the time. */
export type ListMembers = { spaceId: string; now: number };

/** The Space's Members, oldest first, and its pending invitations that have not expired. */
export const listMembers =
	(ports: ListMembersPorts) =>
	async (
		request: ListMembers,
	): Promise<{ members: SpaceMember[]; invitations: PendingInvitation[] }> => {
		const members = await ports.memberStore.membersOf(request.spaceId);
		const invitations = await ports.invitationStore.pendingOf(
			request.spaceId,
			request.now,
		);
		return { members, invitations };
	};
