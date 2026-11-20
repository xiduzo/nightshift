import type { MemberStore } from "./ports";

export type ListRosterPorts = {
	memberStore: Pick<MemberStore, "roster">;
};

/** Which Space. */
export type ListRoster = { spaceId: string };

/** The Members of a Space by Person: their name and role, in no set order. */
export const listRoster =
	(ports: ListRosterPorts) =>
	async (
		request: ListRoster,
	): Promise<{ id: string; name: string; role: string }[]> =>
		ports.memberStore.roster(request.spaceId);
