import type { Role } from "../../../roles";
import type { InvitationStore } from "../../application/ports";
import { type MembersRecords, membersRecords } from "./in-memory-person-store";

/** `InvitationStore` in memory, over the invitations of `records`. */
export function inMemoryInvitationStore(
	records: MembersRecords = membersRecords(),
) {
	const nameOf = (id: string) => records.persons.find((p) => p.id === id)?.name;
	const twin = {
		records,
		async isOpen(request: { id: string; email: string; now: number }) {
			return records.invitations.some(
				(i) =>
					i.id === request.id &&
					i.status === "pending" &&
					i.expiresAt > request.now &&
					i.email.toLowerCase() === request.email,
			);
		},
		async find(id: string) {
			const found = records.invitations.find((i) => i.id === id);
			const spaceName = records.spaces.find(
				(s) => s.id === found?.spaceId,
			)?.name;
			const inviterName = found && nameOf(found.inviterId);
			if (!found || spaceName === undefined || inviterName === undefined) {
				return null;
			}
			return {
				id: found.id,
				email: found.email,
				role: (found.role ?? "member") as Role,
				status: found.status,
				expiresAt: found.expiresAt,
				spaceName,
				inviterName,
			};
		},
		async pendingOf(spaceId: string, now: number) {
			return records.invitations
				.filter(
					(i) =>
						i.spaceId === spaceId &&
						i.status === "pending" &&
						i.expiresAt > now &&
						nameOf(i.inviterId) !== undefined,
				)
				.sort((a, b) => a.createdAt - b.createdAt)
				.map((i) => ({
					id: i.id,
					email: i.email,
					role: (i.role ?? "member") as Role,
					inviterName: nameOf(i.inviterId) as string,
					expiresAt: i.expiresAt,
				}));
		},
	};
	return twin satisfies InvitationStore;
}

export type InMemoryInvitationStore = ReturnType<
	typeof inMemoryInvitationStore
>;
