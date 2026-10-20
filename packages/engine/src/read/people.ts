import { personContact, personNames } from "@nightshift/auth";
import type { Database } from "@nightshift/db";

import type { RunPerson } from "./views";

/**
 * The Persons runs name, read from the Replica's accounts
 * (`@nightshift/auth`): who started a run, and the git identity commits in
 * its worktree get.
 */

/** The names of these Persons, by id. A Person this Replica does not know is missing. */
export async function namesOf(
	db: Database,
	ids: readonly (string | null)[],
): Promise<ReadonlyMap<string, string>> {
	const wanted = [...new Set(ids.filter((id): id is string => id !== null))];
	return personNames(db, wanted);
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
