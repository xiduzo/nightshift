import type { HostSpaces, Memberships, Registry } from "./ports";

/**
 * A Space this computer's owner can offer its profiles to: a shared Space
 * where their role allows it, or, on a Host, the personal Space of a
 * Person whose home Host it is ("Personal of Ada").
 */
export type OfferSpace = { id: string; name: string; personal: boolean };

export type ListOfferSpacesPorts = {
	memberships: Memberships;
	hostSpaces: HostSpaces;
	registry: Pick<Registry, "homePersons">;
	ownerId: string;
};

/** The Spaces this computer's owner can offer profiles to. */
export const listOfferSpaces =
	(ports: ListOfferSpacesPorts) => async (): Promise<OfferSpace[]> => {
		const shared = (await ports.memberships.spacesOf(ports.ownerId))
			.filter(
				(s) =>
					!s.personal &&
					ports.memberships.roleAllows(s.role, { offer: ["make"] }),
			)
			.map((s) => ({ id: s.id, name: s.name, personal: false }));
		const persons = (await ports.registry.homePersons()).filter(
			(person) => person !== ports.ownerId,
		);
		const names = await ports.memberships.personNames(persons);
		const personals: OfferSpace[] = [];
		for (const person of persons) {
			const id = await ports.memberships.personalSpaceIdBySlug(person);
			if (id === null || (await ports.hostSpaces.hostOf(id)) !== null) continue;
			personals.push({
				id,
				name: `Personal of ${names.get(person) ?? "a person"}`,
				personal: true,
			});
		}
		personals.sort((a, b) => a.name.localeCompare(b.name));
		return [...shared, ...personals];
	};
