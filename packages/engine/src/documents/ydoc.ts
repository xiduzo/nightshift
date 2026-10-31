import type { Database } from "@nightshift/db";
import { ydoc } from "@nightshift/db/schema";
import { eq, sql } from "drizzle-orm";
import * as Y from "yjs";

/**
 * A Yjs document this Replica keeps in its `ydoc` table: each document it
 * syncs (`SyncedDocuments`). The full state is written after every
 * change, one write at a time. Changes made while one is written wait for
 * the next, which takes them all.
 */
export type PersistedDocument = {
	readonly name: string;
	readonly doc: Y.Doc;
	/** A number that changes whenever the shared type does (for views). */
	revision(type: object): number;
	/** Makes one change in one transaction. Resolves when the Replica has it. */
	change(fn: () => void): Promise<void>;
	/** Resolves when every change so far is in the Replica. */
	flush(): Promise<void>;
	/** Flushes, then stops writing to the Replica. */
	close(): Promise<void>;
};

/** Yjs documents in the Replica, by name: their full state. */
export type DocumentRows = {
	fetch(name: string): Promise<Uint8Array | null>;
	store(name: string, state: Uint8Array): Promise<void>;
};

export function documentRows(db: Database): DocumentRows {
	return {
		async fetch(name) {
			const [row] = await db
				.select({ state: ydoc.state })
				.from(ydoc)
				.where(eq(ydoc.name, name));
			return row ? new Uint8Array(row.state) : null;
		},
		async store(name, state) {
			const buffer = Buffer.from(state);
			await db
				.insert(ydoc)
				.values({ name, state: buffer })
				.onConflictDoUpdate({
					target: ydoc.name,
					set: {
						state: buffer,
						updatedAt: sql`(cast(unixepoch('subsecond') * 1000 as integer))`,
					},
				});
		},
	};
}

/**
 * Opens a document from the Replica and keeps it there. `afterStore` runs
 * after each write, in the same queue: a change resolves when both are
 * done (the Space document's projection into SQL rows).
 */
export async function openPersistedDocument(options: {
	db: Database;
	name: string;
	/** The transaction origin of the Owner's own changes. */
	origin: unknown;
	/** What the error log calls it: "The Device document". */
	label: string;
	afterStore?: () => Promise<void>;
}): Promise<PersistedDocument> {
	const { name, origin, label, afterStore } = options;
	const rows = documentRows(options.db);
	const doc = new Y.Doc();
	const state = await rows.fetch(name);
	if (state) Y.applyUpdate(doc, state);

	let tail: Promise<void> = Promise.resolve();
	let next: Promise<void> | null = null;
	function persist(): Promise<void> {
		if (next) return next;
		const write = tail
			.catch(() => {})
			.then(async () => {
				next = null;
				await rows.store(name, Y.encodeStateAsUpdate(doc));
				await afterStore?.();
			});
		next = write;
		tail = write;
		return write;
	}
	const onUpdate = () => {
		persist().catch((error) => {
			console.error(`${label} ${name} was not saved:`, error);
		});
	};
	doc.on("update", onUpdate);

	// Every transaction counts the types it changed, ours or a client's.
	const revisions = new WeakMap<object, number>();
	const onTransaction = (transaction: Y.Transaction) => {
		for (const type of transaction.changed.keys()) {
			revisions.set(type, (revisions.get(type) ?? 0) + 1);
		}
	};
	doc.on("beforeObserverCalls", onTransaction);

	return {
		name,
		doc,
		revision: (type) => revisions.get(type) ?? 0,
		async change(fn) {
			doc.transact(fn, origin);
			await persist();
		},
		flush: () => tail.catch(() => {}),
		async close() {
			doc.off("update", onUpdate);
			doc.off("beforeObserverCalls", onTransaction);
			await tail.catch(() => {});
		},
	};
}
