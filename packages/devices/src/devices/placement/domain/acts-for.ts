/**
 * The Person a list or a run acts for. The Host of a Space may know a
 * Person by another id than this computer does.
 */

/** Another Person's Device takes the work of a Person through its Offers only. */
export function throughOffers(
	personId: string | null,
	ownerId: string | null,
): boolean {
	return personId !== null && personId !== ownerId;
}

type Known = {
	people: {
		personInSpace(
			spaceId: string,
			personId: string | null,
		): Promise<string | null>;
	};
	registry: { selfOwnerId(): Promise<string | null> };
};

/** The Person who owns this computer, as the Space's Host knows them. */
export async function ownerIn(
	{ people, registry }: Known,
	spaceId: string,
): Promise<string | null> {
	return people.personInSpace(spaceId, await registry.selfOwnerId());
}

/**
 * The Person a run acts for: the one who starts it, else this computer's
 * owner (a schedule that names no Person fires here for them), as the Host
 * of the Space knows them. A schedule names its Person that way already.
 */
export async function runsFor(
	{ people, registry }: Known,
	spaceId: string,
	start: { startedBy?: string | undefined; scheduled: boolean },
): Promise<string | null> {
	if (start.scheduled && start.startedBy) return start.startedBy;
	return people.personInSpace(
		spaceId,
		start.startedBy ?? (await registry.selfOwnerId()),
	);
}

/** A Person's name, when Night Shift knows it. */
export async function nameOf(
	personNames: (ids: readonly string[]) => Promise<Map<string, string>>,
	personId: string | null,
): Promise<string | undefined> {
	if (!personId) return undefined;
	return (await personNames([personId])).get(personId) || undefined;
}
