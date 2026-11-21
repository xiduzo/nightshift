import type { SecretEnv, SecretUse } from "../../../contract";
import { notRead } from "../domain/secret-uses";
import type { noteSecretUse } from "./note-secret-use";
import type { resolveSecrets } from "./resolve-secrets";

export type ReadSecretEnvPorts = {
	resolve: ReturnType<typeof resolveSecrets>;
	noteUse: ReturnType<typeof noteSecretUse>;
};

/** The names a Command node's step reads, and the facts of the use. */
export type ReadSecretEnv = { names: readonly string[]; use?: SecretUse };

/**
 * Secrets by name, each as an environment variable of that name, from the
 * scopes of `use`. `missing` names the ones with no value: then `env` is
 * not given, and nothing is a use.
 */
export const readSecretEnv =
	(ports: ReadSecretEnvPorts) =>
	async ({ names, use }: ReadSecretEnv): Promise<SecretEnv> => {
		const resolved = await ports.resolve({ names, use });
		const { vars } = resolved;
		const env: Record<string, string> = {};
		const missing: string[] = [];
		for (const name of new Set(names)) {
			const value = vars[name];
			if (value === undefined) missing.push(name);
			else env[name] = value;
		}
		if (missing.length > 0) {
			return { ok: false, missing, ...notRead(resolved) };
		}
		ports.noteUse(names);
		return {
			ok: true,
			env,
			...(resolved.fromProject.size > 0
				? { fromProject: [...resolved.fromProject] }
				: {}),
		};
	};
