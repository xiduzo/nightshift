import type { Database } from "@nightshift/db";
import { webPushKey } from "@nightshift/db/schema";
import { eq } from "drizzle-orm";
import { generateVAPIDKeys } from "web-push";

/**
 * The VAPID key pair this daemon signs its Web Push messages with. The
 * daemon that sends for a Space (a Host for the Spaces it keeps) makes it
 * once, the first time it is needed, and keeps it in `web_push_key`. A
 * browser subscribes with the public key, so the pair never changes: a new
 * pair would lose every browser subscription.
 */

/** A VAPID key pair, URL-safe base64. */
export type VapidKeys = { publicKey: string; privateKey: string };

export type VapidKeyStore = {
	/** The pair: the saved one, or a new one saved now. */
	get(): Promise<VapidKeys>;
};

const ROW_ID = "vapid";

export function createVapidKeyStore(
	db: Database,
	generate: () => VapidKeys = generateVAPIDKeys,
): VapidKeyStore {
	let kept: Promise<VapidKeys> | null = null;

	async function read(): Promise<VapidKeys | null> {
		const [row] = await db
			.select({
				publicKey: webPushKey.publicKey,
				privateKey: webPushKey.privateKey,
			})
			.from(webPushKey)
			.where(eq(webPushKey.id, ROW_ID));
		return row ?? null;
	}

	async function load(): Promise<VapidKeys> {
		const saved = await read();
		if (saved) return saved;
		const fresh = generate();
		// Two daemons on one database: the first pair saved wins.
		await db
			.insert(webPushKey)
			.values({ id: ROW_ID, ...fresh })
			.onConflictDoNothing();
		const pair = await read();
		if (!pair) throw new Error("The Web Push keys were not saved.");
		return pair;
	}

	return {
		get() {
			kept ??= load().catch((error) => {
				kept = null;
				throw error;
			});
			return kept;
		},
	};
}
