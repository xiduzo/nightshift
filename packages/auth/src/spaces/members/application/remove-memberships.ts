import type { MemberStore } from "./ports";

export type RemoveMembershipsPorts = {
	memberStore: Pick<MemberStore, "remove">;
};

/** Which Person leaves which Spaces. */
export type RemoveMemberships = {
	spaceIds: readonly string[];
	personId: string;
};

/** Ends the Person's memberships of these Spaces. */
export const removeMemberships =
	(ports: RemoveMembershipsPorts) =>
	async (request: RemoveMemberships): Promise<void> => {
		await ports.memberStore.remove(request.spaceIds, request.personId);
	};
