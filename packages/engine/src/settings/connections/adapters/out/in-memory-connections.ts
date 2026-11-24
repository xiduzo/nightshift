import { writeConnection } from "../../application/write-connection";
import { withVariables } from "../../domain/saved-connection";
import type { ConnectionStore } from "../../wire";
import { inMemoryConnectionSecrets } from "./in-memory-neighbours";
import { inMemorySavedConnections } from "./in-memory-saved-connections";

/**
 * The connections over in-memory adapters: the real use case behind the
 * store, with the secrets a test sets. The use-case test of every slice that
 * reads or saves a connection takes this one. Test code: production code
 * never imports this file.
 */
export function inMemoryConnections(
	names: readonly string[] = [],
	secrets = inMemoryConnectionSecrets(),
) {
	const server = { url: "https://mcp.example.com" };
	const saved = inMemorySavedConnections(
		names.map((name) => [name, { description: null, server, updatedAt: 1 }]),
	);
	const view = () =>
		[...saved.read().values()]
			.sort((a, b) => a.name.localeCompare(b.name))
			.map((one) => withVariables(one, secrets.secretSource));
	const bound = {
		list: view,
		get: (name) => view().find((one) => one.name === name) ?? null,
		save: writeConnection({ saved, secrets, now: () => 1 }),
		remove: (name) => saved.remove(name),
	} satisfies Partial<ConnectionStore>;
	return { ...bound, saved };
}
