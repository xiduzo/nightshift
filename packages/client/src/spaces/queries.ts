import type { ApiQueryUtils } from "../api";

/** The query options of Spaces, their Members and invitations. */
export function createSpaceQueries(orpc: ApiQueryUtils) {
	return {
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
}
