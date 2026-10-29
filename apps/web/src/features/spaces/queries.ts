/**
 * The query options of Spaces, their Members and invitations
 * (`@nightshift/client`, on this app's client), and their mutations.
 */

import { createSpaceQueries } from "@nightshift/client";

import { orpc } from "@/shared/api";

export const spaceQueries = createSpaceQueries(orpc);

export const spaceMutations = {
	create: orpc.spaces.create.mutationOptions,
	switch: orpc.spaces.switch.mutationOptions,
	invite: orpc.members.invite.mutationOptions,
	setRole: orpc.members.setRole.mutationOptions,
	removeMember: orpc.members.remove.mutationOptions,
	cancelInvitation: orpc.members.cancelInvitation.mutationOptions,
	acceptInvitation: orpc.invitations.accept.mutationOptions,
};
