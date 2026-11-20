import type { MemberStore } from "./ports";

export type FindMembershipPorts = {
	memberStore: Pick<MemberStore, "membershipOf">;
};

/** Which Person, in which Space. */
export type FindMembership = { spaceId: string; personId: string };

/** The Person's membership of the Space (its id and role), or null. */
export const findMembership =
	(ports: FindMembershipPorts) =>
	async (
		request: FindMembership,
	): Promise<{ id: string; role: string } | null> =>
		ports.memberStore.membershipOf(request.spaceId, request.personId);
