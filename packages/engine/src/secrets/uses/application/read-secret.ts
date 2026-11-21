import type { SecretUse } from "../../../contract";
import type { noteSecretUse } from "./note-secret-use";
import type { resolveSecrets } from "./resolve-secrets";

export type ReadSecretPorts = {
	resolve: ReturnType<typeof resolveSecrets>;
	noteUse: ReturnType<typeof noteSecretUse>;
};

/** The name to read, and the facts of its use. */
export type ReadSecret = { name: string; use?: SecretUse };

/** A secret's value, to use: the scopes of `use` in their order (`secretScopes`). A value read is a use. */
export const readSecret =
	(ports: ReadSecretPorts) =>
	async ({ name, use }: ReadSecret): Promise<string | undefined> => {
		const value = (await ports.resolve({ names: [name], use })).vars[name];
		if (value !== undefined) ports.noteUse([name]);
		return value;
	};
