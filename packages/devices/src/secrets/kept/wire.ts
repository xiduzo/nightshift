import type { Database } from "@nightshift/db";
import { drizzlePersonalSecretStore } from "./adapters/out/drizzle-personal-secret-store";
import { drizzleProjectSecretStore } from "./adapters/out/drizzle-project-secret-store";
import { drizzleSpaceSecretStore } from "./adapters/out/drizzle-space-secret-store";
import { webcryptoSecretsCipher } from "./adapters/out/webcrypto-secrets-cipher";
import type {
	PersonalSecretStore,
	ProjectSecretStore,
	SpaceSecretStore,
} from "./application/ports";

/**
 * The wiring of the kept secrets: the one place that builds the cipher
 * of this computer's secrets key and the three stores it seals with.
 */

/** What the package gives the kept secrets. */
export type KeptDeps = {
	db: Database;
	/** This computer's secrets key (`NIGHTSHIFT_SECRETS_KEY`, else the data folder's). */
	secretsKey: string;
	now?: () => number;
};

/** The stores of the secrets this computer keeps, sealed at rest. */
export type Kept = {
	/** The Personal secrets: as a Home Host, and its owner's without one. */
	personal: PersonalSecretStore;
	/** The Project secrets: of the Spaces it keeps, as their Host or without one. */
	projects: ProjectSecretStore;
	/** The Space secrets: of the Spaces it keeps, as their Host or without one. */
	spaces: SpaceSecretStore;
};

export function wireKept(deps: KeptDeps): Kept {
	const { db } = deps;
	const cipher = webcryptoSecretsCipher(deps.secretsKey);
	const at = deps.now ? { db, cipher, now: deps.now } : { db, cipher };
	return {
		personal: drizzlePersonalSecretStore(at),
		projects: drizzleProjectSecretStore(at),
		spaces: drizzleSpaceSecretStore(at),
	};
}
