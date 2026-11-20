import type { PersonalSpaceStore } from "../../application/ports";
import type { RowBatch } from "../../domain/personal-space";

/**
 * The rows the in-memory adapters of personal share, as one Replica holds
 * them: its Persons, its Spaces, their memberships and invitations, and
 * the Space each session works in.
 */
export type PersonalRecords = {
	persons: { id: string; name: string; email: string; role: string }[];
	spaces: { id: string; name: string; slug: string; personal: boolean }[];
	members: { id: string; spaceId: string; personId: string; role: string }[];
	invitations: { id: string; spaceId: string }[];
	sessions: { id: string; spaceId: string | null }[];
};

/** An empty Replica. */
export function personalRecords(): PersonalRecords {
	return {
		persons: [],
		spaces: [],
		members: [],
		invitations: [],
		sessions: [],
	};
}

type Row = (records: PersonalRecords) => void;

/** Runs the rows of a batch that `inMemoryPersonalSpaceStore` made, in order. */
export function applyRows(records: PersonalRecords, batch: RowBatch): void {
	for (const row of batch as readonly unknown[] as Row[]) row(records);
}

/** `PersonalSpaceStore` in memory, over `records`. Its row batches run with `applyRows`. */
export function inMemoryPersonalSpaceStore(records = personalRecords()) {
	const space = (id: string) => records.spaces.find((s) => s.id === id);
	const moveSessions =
		(from: string, to: string): Row =>
		(r) => {
			for (const s of r.sessions) if (s.spaceId === from) s.spaceId = to;
		};
	const twin = {
		records,
		async personalSpaceId(personId: string) {
			const found = records.members.find(
				(m) => m.personId === personId && space(m.spaceId)?.personal,
			);
			return found?.spaceId ?? null;
		},
		async spaceIdBySlug(slug: string) {
			return records.spaces.find((s) => s.slug === slug)?.id ?? null;
		},
		async exists(spaceId: string) {
			return space(spaceId) !== undefined;
		},
		async membershipId(spaceId: string, personId: string) {
			return (
				records.members.find(
					(m) => m.spaceId === spaceId && m.personId === personId,
				)?.id ?? null
			);
		},
		async create(made: {
			id: string;
			name: string;
			slug: string;
			personId: string;
			membershipId: string;
		}) {
			// Both rows or neither: a membership needs a Person.
			if (!records.persons.some((p) => p.id === made.personId)) {
				throw new Error(`No Person ${made.personId}.`);
			}
			records.spaces.push({
				id: made.id,
				name: made.name,
				slug: made.slug,
				personal: true,
			});
			records.members.push({
				id: made.membershipId,
				spaceId: made.id,
				personId: made.personId,
				role: "owner",
			});
		},
		adoptRows(change: {
			personId: string;
			from: string;
			to: string;
			name: string;
			membershipId: string | null;
			newMembershipId: string;
		}) {
			const { from, to } = change;
			const rows: Row[] = [
				(r) => {
					const found = r.members.find((m) => m.id === change.membershipId);
					if (found) found.role = "owner";
					else {
						r.members.push({
							id: change.newMembershipId,
							spaceId: to,
							personId: change.personId,
							role: "owner",
						});
					}
				},
				(r) => {
					const target = r.spaces.find((s) => s.id === to);
					if (target)
						Object.assign(target, { personal: true, name: change.name });
				},
				moveSessions(from, to),
				(r) => {
					r.invitations = r.invitations.filter((i) => i.spaceId !== from);
				},
				(r) => {
					r.members = r.members.filter((m) => m.spaceId !== from);
				},
				(r) => {
					r.spaces = r.spaces.filter((s) => s.id !== from);
				},
			];
			return rows as unknown as RowBatch;
		},
		splitRows(change: {
			personId: string;
			from: string;
			to: string;
			name: string;
			slug: string;
			membershipId: string;
			fromName: string;
		}) {
			const { from, to } = change;
			const rows: Row[] = [
				(r) => {
					r.spaces.push({
						id: to,
						name: change.name,
						slug: change.slug,
						personal: true,
					});
				},
				(r) => {
					r.members.push({
						id: change.membershipId,
						spaceId: to,
						personId: change.personId,
						role: "owner",
					});
				},
				(r) => {
					const old = r.spaces.find((s) => s.id === from);
					if (old)
						Object.assign(old, { personal: false, name: change.fromName });
				},
				(r) => {
					r.members = r.members.filter(
						(m) => !(m.spaceId === from && m.personId === change.personId),
					);
				},
				moveSessions(from, to),
			];
			return rows as unknown as RowBatch;
		},
	};
	return twin satisfies PersonalSpaceStore;
}

export type InMemoryPersonalSpaceStore = ReturnType<
	typeof inMemoryPersonalSpaceStore
>;
