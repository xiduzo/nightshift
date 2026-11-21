import type { NotRead, SecretUse } from "../../../contract";
import { expandReferences, referencesIn } from "../domain/references";
import { notRead } from "../domain/secret-uses";
import type { noteSecretUse } from "./note-secret-use";
import type { resolveSecrets } from "./resolve-secrets";

export type ExpandSecretReferencesPorts = {
	resolve: ReturnType<typeof resolveSecrets>;
	noteUse: ReturnType<typeof noteSecretUse>;
};

/** Values that may hold `${NAME}` references, and the facts of their use. */
export type ExpandSecretReferences = {
	values: Record<string, string>;
	use?: SecretUse;
};

/** Values with `${NAME}` expanded, and the values read for them, or the names that have none. */
export type ExpandedEnv =
	| { ok: true; env: Record<string, string>; values: string[] }
	| ({ ok: false; missing: string[] } & NotRead);

/**
 * Environment values with `${NAME}` expanded from the secrets, then the
 * environment: a custom agent's env. `missing` names the references with
 * no value: then nothing is expanded, and nothing is a use.
 */
export const expandSecretReferences =
	(ports: ExpandSecretReferencesPorts) =>
	async ({ values, use }: ExpandSecretReferences): Promise<ExpandedEnv> => {
		const names = referencesIn(Object.values(values));
		const resolved = await ports.resolve({ names, use });
		const { vars } = resolved;
		const missing = names.filter((name) => vars[name] === undefined);
		if (missing.length > 0) {
			return { ok: false, missing, ...notRead(resolved) };
		}
		ports.noteUse(names);
		return {
			ok: true,
			values: names.flatMap((name) => (vars[name] ? [vars[name]] : [])),
			env: Object.fromEntries(
				Object.entries(values).map(([key, value]) => [
					key,
					expandReferences(value, vars),
				]),
			),
		};
	};
