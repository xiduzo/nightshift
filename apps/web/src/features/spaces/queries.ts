/** The query and mutation options of Spaces, their Members and invitations. */

import { orpc } from "@/shared/api";

export const spaceQueries = {
	/** The Spaces of the person, and the active one. */
	list: () => orpc.spaces.list.queryOptions(),
	/** The Members and open invitations of the active Space. */
	members: () => orpc.members.list.queryOptions(),
	/** Every Members query. Invalidate it after a Member or an invitation changes. */
	membersKey: () => orpc.members.list.key(),
	/** One invitation, as its link shows it. */
	invitation: (invitationId: string) =>
		orpc.invitations.get.queryOptions({ input: { invitationId } }),
};

export const spaceMutations = {
	create: orpc.spaces.create.mutationOptions,
	switch: orpc.spaces.switch.mutationOptions,
	invite: orpc.members.invite.mutationOptions,
	setRole: orpc.members.setRole.mutationOptions,
	removeMember: orpc.members.remove.mutationOptions,
	cancelInvitation: orpc.members.cancelInvitation.mutationOptions,
	acceptInvitation: orpc.invitations.accept.mutationOptions,
};
