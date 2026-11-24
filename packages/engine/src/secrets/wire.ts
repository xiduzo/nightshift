import { type EditAccess, type Edits, wireEdits } from "./edits";
import { type SecretSource, sourceOf, wireScopes } from "./scopes";
import { type Uses, wireUses } from "./uses";

/**
 * The wiring of secrets: it builds the scopes once (the ports and the
 * memory of names that every use case shares), and binds the uses and the
 * edits to them.
 */

/** The use cases of secrets, bound to their ports, with the two reads the screens and the readers subscribe to. */
export type Secrets = Uses &
	Edits & {
		/** Where a name gets its value, as this computer knows the Personal names now. Synchronous. */
		secretSource(name: string): SecretSource;
		/** Calls `listener` after a secret is saved, moved or removed, here or synced. Returns the unsubscribe. */
		onSecretsChange(listener: () => void): () => void;
	};

export function wireSecrets(
	deps: Parameters<typeof wireScopes>[0] & EditAccess,
): Secrets {
	const scopes = wireScopes(deps);
	const { facts, known, env } = scopes;
	return {
		...wireUses(scopes),
		...wireEdits({
			...scopes,
			computerAccess: deps.computerAccess,
			access: deps.access,
		}),
		secretSource: (name) =>
			sourceOf(name, { personal: known.personal, saved: facts.saved(), env }),
		onSecretsChange(listener) {
			const stopSaved = facts.onSavedChange(listener);
			const stopPersonal = known.onPersonalChange(listener);
			return () => {
				stopSaved();
				stopPersonal();
			};
		},
	};
}
