import type { MemberStore } from "./ports";

export type SetMembershipRolePorts = {
	memberStore: Pick<MemberStore, "setRole">;
};

/** Which membership, and its new role. */
export type SetMembershipRole = { membershipId: string; role: string };

/** Gives a membership another role. */
export const setMembershipRole =
	(ports: SetMembershipRolePorts) =>
	async (request: SetMembershipRole): Promise<void> => {
		await ports.memberStore.setRole(request.membershipId, request.role);
	};
