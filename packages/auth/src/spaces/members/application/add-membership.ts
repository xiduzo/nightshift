import type { MemberStore } from "./ports";

export type AddMembershipPorts = {
	memberStore: Pick<MemberStore, "add">;
	/** A new id for the membership. */
	newId: () => string;
};

/** Who joins which Space, in which role. */
export type AddMembership = { spaceId: string; personId: string; role: string };

/** Makes the Person a Member of the Space in that role. */
export const addMembership =
	(ports: AddMembershipPorts) =>
	async (request: AddMembership): Promise<void> => {
		await ports.memberStore.add({ id: ports.newId(), ...request });
	};
