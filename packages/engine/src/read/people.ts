import { personContact, personNames } from "@nightshift/auth";
import type { Database } from "@nightshift/db";

import type { RunPerson } from "./views";

/**
 * The Persons runs name, read from the Replica's accounts
 * (`@nightshift/auth`): who started a run, and the git identity commits in
 * its worktree get.
 */

/** The name of a Person as the Members of a Space name them, or null. */
export type MemberName = (personId: string) => Promise<string | null>;

/**
 * The names of these Persons, by id: from the Replica's accounts, else
 * from `member` (the Members the Space document mirrors). A Device has no
 * account of a Person its Host knows, such as the one who started a run
 * on the Host. A Person neither knows is missing.
 */
export async function namesOf(
	db: Database,
	ids: readonly (string | null)[],
	member?: MemberName,
): Promise<ReadonlyMap<string, string>> {
	const wanted = [...new Set(ids.filter((id): id is string => id !== null))];
	const names = new Map(await personNames(db, wanted));
	if (!member) return names;
	for (const id of wanted) {
		if (names.has(id)) continue;
		const name = await member(id);
		if (name) names.set(id, name);
	}
	return names;
}

/** The Person of `id` as a run names them, with their name when known. */
export function runPerson(
	id: string | null,
	names: ReadonlyMap<string, string>,
): RunPerson | null {
	return id === null ? null : { id, name: names.get(id) ?? null };
}

/**
 * The git identity of a Person: their name and email. Null for a Person
 * with no real email (this computer's own Person, `…@nightshift.invalid`)
 * or one this Replica does not know: the repository keeps its own.
 */
export async function gitAuthorOf(
	db: Database,
	personId: string,
): Promise<{ name: string; email: string } | null> {
	const row = await personContact(db, personId);
	if (!row || row.email.toLowerCase().endsWith(".invalid")) return null;
	return { name: row.name.trim() || row.email, email: row.email };
}
