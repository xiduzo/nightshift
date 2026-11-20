import type { SpaceStore } from "../../application/ports";
import type { Role } from "../../roles";

/** The rows of the in-memory `SpaceStore`: Spaces and memberships. */
export type SpaceRecords = {
	spaces: { id: string; name: string; slug: string; personal: boolean }[];
	members: { spaceId: string; personId: string; role: string }[];
};

/** `SpaceStore` in memory. A test puts rows on `records`. */
export function inMemorySpaceStore() {
	const records: SpaceRecords = { spaces: [], members: [] };
	const twin = {
		records,
		async spacesOf(personId: string) {
			return records.members
				.filter((m) => m.personId === personId)
				.flatMap((m) => {
					const space = records.spaces.find((s) => s.id === m.spaceId);
					return space
						? [
								{
									id: space.id,
									name: space.name,
									personal: space.personal,
									role: m.role as Role,
								},
							]
						: [];
				})
				.sort(
					(a, b) =>
						Number(b.personal) - Number(a.personal) ||
						(a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
				);
		},
		async roleOf(personId: string, spaceId: string) {
			const found = records.members.find(
				(m) => m.personId === personId && m.spaceId === spaceId,
			);
			return (found?.role as Role | undefined) ?? null;
		},
		async exists(spaceId: string) {
			return records.spaces.some((s) => s.id === spaceId);
		},
		async ids() {
			return records.spaces.map((s) => s.id);
		},
		async mirror(space: { id: string; name: string }) {
			const found = records.spaces.find((s) => s.id === space.id);
			if (found) found.name = space.name;
			else {
				records.spaces.push({
					...space,
					slug: `host-${space.id}`,
					personal: false,
				});
			}
		},
	};
	return twin satisfies SpaceStore;
}

export type InMemorySpaceStore = ReturnType<typeof inMemorySpaceStore>;
