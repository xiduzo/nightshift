import { join } from "node:path";
import type { Database } from "@nightshift/db";
import { hostLink } from "@nightshift/db/schema";
import {
	type KeyStoreKind,
	valueStore,
} from "@nightshift/engine/device-config";
import { Refusal } from "@nightshift/refusal";
import { and, asc, eq, isNotNull, isNull, ne } from "drizzle-orm";

export type { KeyStoreKind } from "@nightshift/engine/device-config";

/**
 * This computer's links to the Hosts it paired with: one home Host at
 * most (it keeps this Device's document), and any number of guest Hosts
 * (shared Spaces only). A link is this Device's own fact, kept in its
 * Replica; the Device key is kept apart, in a `DeviceKeyStore`. The
 * links are the one record of this computer's home Host (`home`).
 */

export type HostRole = "home" | "guest";

export type HostLink = {
	/** The Host's Device id. */
	hostId: string;
	name: string;
	/** In the order to try them. */
	addresses: string[];
	/** The PEM of the Host's self-signed certificate, pinned at pairing. */
	certificate: string | null;
	fingerprint: string | null;
	role: HostRole;
	/** The Person on the Host who owns this Device there. */
	personId: string;
	keyStore: KeyStoreKind;
	createdAt: number;
	/** When the Host refused the key: its owner removed this computer's access. */
	revokedAt: number | null;
};

export type HostLinks = {
	list(): Promise<HostLink[]>;
	get(hostId: string): Promise<HostLink | null>;
	/** This computer's home Host: its home link with access (`isHomeHost`), if any. */
	home(): Promise<HostLink | null>;
	/**
	 * Saves the link of a pairing that just ended, replacing an earlier one
	 * to the same Host. A second home Host is refused while the first still
	 * has access: a home link without access is replaced.
	 */
	save(link: Omit<HostLink, "createdAt" | "revokedAt">): Promise<HostLink>;
	/** The Host's addresses as it lists them now. */
	setAddresses(hostId: string, addresses: string[]): Promise<void>;
	/** The Host refused the key: the link stays, marked, and stops. */
	revoked(hostId: string): Promise<void>;
};

export const SECOND_HOME =
	"This computer already has a home Host. Join this one as a guest, or remove the other one first.";

export function createHostLinks(db: Database): HostLinks {
	function toLink(row: typeof hostLink.$inferSelect): HostLink {
		return {
			hostId: row.hostId,
			name: row.name,
			addresses: parseAddresses(row.addresses),
			certificate: row.certificate,
			fingerprint: row.fingerprint,
			role: row.role,
			personId: row.personId,
			keyStore: row.keyStore,
			createdAt: row.createdAt.getTime(),
			revokedAt: row.revokedAt?.getTime() ?? null,
		};
	}

	async function get(hostId: string) {
		const [row] = await db
			.select()
			.from(hostLink)
			.where(eq(hostLink.hostId, hostId));
		return row ? toLink(row) : null;
	}

	async function list() {
		const rows = await db
			.select()
			.from(hostLink)
			.orderBy(asc(hostLink.role), asc(hostLink.createdAt));
		return rows.map(toLink);
	}

	async function home() {
		return (await list()).find(isHomeHost) ?? null;
	}

	return {
		list,
		get,
		home,
		async save(link) {
			// The check reads before the batch writes: a pairing is one at a
			// time, and the batch replaces only a home link without access.
			const other = link.role === "home" ? await home() : null;
			if (other && other.hostId !== link.hostId) {
				throw new Refusal("conflict", SECOND_HOME);
			}
			const values = {
				name: link.name,
				addresses: JSON.stringify(link.addresses),
				certificate: link.certificate,
				fingerprint: link.fingerprint,
				role: link.role,
				personId: link.personId,
				keyStore: link.keyStore,
				revokedAt: null,
			};
			const upsert = db
				.insert(hostLink)
				.values({ hostId: link.hostId, ...values })
				.onConflictDoUpdate({ target: hostLink.hostId, set: values });
			if (link.role === "home") {
				await db.batch([
					db
						.delete(hostLink)
						.where(
							and(
								eq(hostLink.role, "home"),
								ne(hostLink.hostId, link.hostId),
								isNotNull(hostLink.revokedAt),
							),
						),
					upsert,
				]);
			} else {
				await upsert;
			}
			const saved = await get(link.hostId);
			if (!saved) throw new Error("The link to the Host was not saved.");
			return saved;
		},
		async setAddresses(hostId, addresses) {
			const link = await get(hostId);
			if (!link) return;
			if (JSON.stringify(link.addresses) === JSON.stringify(addresses)) return;
			await db
				.update(hostLink)
				.set({ addresses: JSON.stringify(addresses) })
				.where(eq(hostLink.hostId, hostId));
		},
		async revoked(hostId) {
			await db
				.update(hostLink)
				.set({ revokedAt: new Date() })
				.where(and(eq(hostLink.hostId, hostId), isNull(hostLink.revokedAt)));
		},
	};
}

/** Whether the link is to this computer's home Host now: a home link with access. */
export function isHomeHost(
	link: Pick<HostLink, "role" | "revokedAt">,
): boolean {
	return link.role === "home" && link.revokedAt === null;
}

function parseAddresses(text: string): string[] {
	try {
		const value = JSON.parse(text);
		return Array.isArray(value)
			? value.filter((v): v is string => typeof v === "string")
			: [];
	} catch {
		return [];
	}
}

/** The Device keys this computer holds, one per Host. */
export type DeviceKeyStore = {
	readonly kind: KeyStoreKind;
	get(hostId: string): Promise<string | null>;
	set(hostId: string, key: string): Promise<void>;
	delete(hostId: string): Promise<void>;
};

const KEYCHAIN_SERVICE = "nightshift-device-keys";

/**
 * The system keychain (`Bun.secrets`) where it works, else a file per Host
 * in the data directory, readable by this user only (a headless computer
 * has no keychain). `prefer: "file"` skips the keychain.
 */
export function deviceKeyStore(options: {
	dataDir: string;
	prefer?: KeyStoreKind;
}): Promise<DeviceKeyStore> {
	return valueStore({
		service: KEYCHAIN_SERVICE,
		dir: join(options.dataDir, "device-keys"),
		prefer: options.prefer,
	});
}
