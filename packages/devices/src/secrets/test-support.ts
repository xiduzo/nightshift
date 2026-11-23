import { drizzlePersonalSecretStore } from "./kept/adapters/out/drizzle-personal-secret-store";
import { drizzleProjectSecretStore } from "./kept/adapters/out/drizzle-project-secret-store";
import { drizzleSpaceSecretStore } from "./kept/adapters/out/drizzle-space-secret-store";
import { webcryptoSecretsCipher } from "./kept/adapters/out/webcrypto-secrets-cipher";

/**
 * The old names of the secrets, for the database tests of this folder
 * (`secrets.test.ts`, `project-secrets.test.ts`, `moves.test.ts`). They
 * build what the slice's wire builds, with the same arguments as before.
 */

export const secretsCipher = webcryptoSecretsCipher;
export const createPersonalSecretStore = drizzlePersonalSecretStore;
export const createProjectSecretStore = drizzleProjectSecretStore;
export const createSpaceSecretStore = drizzleSpaceSecretStore;
