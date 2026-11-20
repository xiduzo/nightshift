import { randomUUID } from "node:crypto";
import { userInfo } from "node:os";
import type { Database } from "@nightshift/db";
import { drizzleLocalPersonStore } from "./adapters/out/drizzle-local-person-store";
import { drizzlePersonalSpaceStore } from "./adapters/out/drizzle-personal-space-store";
import { adoptPersonalSpace } from "./application/adopt-personal-space";
import { ensurePersonalSpace } from "./application/ensure-personal-space";
import { findLocalPerson } from "./application/find-local-person";
import { findPersonalSpace } from "./application/find-personal-space";
import { findPersonalSpaceBySlug } from "./application/find-personal-space-by-slug";
import { splitPersonalSpace } from "./application/split-personal-space";

/**
 * The wiring of personal: the one place that builds its real adapters
 * and binds each use case to its ports.
 */

/** What the package gives personal: what the real adapters stand on, and the Host admin claim of members. */
export type PersonalDeps = {
	db: Database;
	/** Makes the Person the Host admin when the Host has none (`claimHostAdmin` of members). */
	claimHostAdmin: (request: { personId: string }) => Promise<void>;
};

/** The use cases of personal, bound to their ports. */
export type Personal = {
	/** The id of the Person's personal Space, or null. */
	findPersonalSpace: ReturnType<typeof findPersonalSpace>;
	/** The id of the Person's personal Space by its slug, or null. */
	findPersonalSpaceBySlug: ReturnType<typeof findPersonalSpaceBySlug>;
	/** The Person's personal Space: made with its owner membership when there is none. */
	ensurePersonalSpace: ReturnType<typeof ensurePersonalSpace>;
	/** The Person who owns this computer's Device, and their personal Space. */
	findLocalPerson: ReturnType<typeof findLocalPerson>;
	/** The statements that make the Home Host's Space the Person's personal Space. */
	adoptPersonalSpace: ReturnType<typeof adoptPersonalSpace>;
	/** The statements that give the Person a new personal Space of this Replica's own. */
	splitPersonalSpace: ReturnType<typeof splitPersonalSpace>;
};

export function wirePersonal(deps: PersonalDeps): Personal {
	const ports = {
		newId: () => randomUUID(),
		accountName,
		personalSpaceStore: drizzlePersonalSpaceStore(deps.db),
		localPersonStore: drizzleLocalPersonStore(deps.db),
		claimHostAdmin: deps.claimHostAdmin,
	};
	const ensure = ensurePersonalSpace(ports);
	return {
		findPersonalSpace: findPersonalSpace(ports),
		findPersonalSpaceBySlug: findPersonalSpaceBySlug(ports),
		ensurePersonalSpace: ensure,
		findLocalPerson: findLocalPerson({ ...ports, ensurePersonalSpace: ensure }),
		adoptPersonalSpace: adoptPersonalSpace(ports),
		splitPersonalSpace: splitPersonalSpace(ports),
	};
}

/** The name of this computer's account, or "You". */
function accountName(): string {
	try {
		return userInfo().username || "You";
	} catch {
		return "You";
	}
}
