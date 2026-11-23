import { Refusal } from "@nightshift/refusal";
import { type ProfileBook, rewriteProfiles } from "./profile-edits";

/**
 * The edits of a connection and a CLI tool that change the profiles that
 * name it: a rename moves them to the new name, a removal takes it off.
 */

export function connectionTaken(name: string): string {
	return `A connection named "${name}" already exists. Pick another name.`;
}

/** The connections, as an edit reads, saves and removes them. */
export type ConnectionBook<Input extends { name: string }, Saved> = {
	get(name: string): unknown;
	save(input: Input): Promise<Saved>;
	remove(name: string): Promise<void>;
};

/**
 * Adds a connection, or changes or renames one (`previousName`). A rename
 * moves the profiles that name the old name to the new one.
 */
export async function saveConnection<Input extends { name: string }, Saved>(
	stores: {
		connections: ConnectionBook<Input, Saved>;
		profiles: Pick<ProfileBook, "list" | "save">;
	},
	connection: Input,
	previousName?: string,
): Promise<Saved> {
	if (
		previousName !== connection.name &&
		stores.connections.get(connection.name)
	) {
		throw new Refusal("conflict", connectionTaken(connection.name));
	}
	const saved = await stores.connections.save(connection);
	if (previousName && previousName !== connection.name) {
		await stores.connections.remove(previousName);
		await rewriteProfiles(stores.profiles, (p) =>
			p.connections.includes(previousName)
				? {
						connections: p.connections.map((c) =>
							c === previousName ? connection.name : c,
						),
					}
				: null,
		);
	}
	return saved;
}

/** Removes a connection, and takes it off the profiles that name it. */
export async function removeConnection(
	stores: {
		connections: { remove(name: string): Promise<void> };
		profiles: Pick<ProfileBook, "list" | "save">;
	},
	name: string,
): Promise<void> {
	await stores.connections.remove(name);
	await rewriteProfiles(stores.profiles, (p) =>
		p.connections.includes(name)
			? { connections: p.connections.filter((c) => c !== name) }
			: null,
	);
}

/** Removes a CLI tool, and takes it off the profiles that name it. */
export async function removeCliTool(
	stores: {
		cliTools: { remove(name: string): Promise<void> };
		profiles: Pick<ProfileBook, "list" | "save">;
	},
	name: string,
): Promise<void> {
	await stores.cliTools.remove(name);
	await rewriteProfiles(stores.profiles, (p) =>
		p.clis.includes(name) ? { clis: p.clis.filter((c) => c !== name) } : null,
	);
}
