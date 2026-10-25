import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import type { QueryClient } from "@tanstack/react-query";
import { persistQueryClient } from "@tanstack/react-query-persist-client";
import Constants from "expo-constants";
import { Directory, File, Paths } from "expo-file-system";
import * as Updates from "expo-updates";

import { keptQuery } from "./kept-queries";

/** How long a kept read may show at the next start. Older ones are dropped. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * A new build or update of the app drops what the phone kept: its screens
 * may read the data another way.
 */
const BUSTER = `${Constants.expoConfig?.version ?? "0"}:${Updates.updateId ?? "embedded"}`;

/** The folder of the kept reads, in the phone's cache: the system may clear it, which only costs a read. */
function folder(): Directory {
	return new Directory(Paths.cache, "kept-queries");
}

function fileOf(key: string): File {
	return new File(folder(), `${encodeURIComponent(key)}.json`);
}

/** The keys of Persons who signed out: a write still on its way does not bring their reads back. */
const forgotten = new Set<string>();

/** One file per Host and Person. */
const storage = {
	async getItem(key: string): Promise<string | null> {
		const file = fileOf(key);
		return file.exists ? file.text() : null;
	},
	async setItem(key: string, value: string): Promise<void> {
		if (forgotten.has(key)) return;
		const dir = folder();
		if (!dir.exists) dir.create({ intermediates: true });
		const file = fileOf(key);
		if (!file.exists) file.create();
		await file.write(value);
	},
	async removeItem(key: string): Promise<void> {
		const file = fileOf(key);
		if (file.exists) file.delete();
	},
};

/** The key of what the phone keeps for one Person at one Host. */
function keyOf(address: string, personId: string): string {
	return `${address} ${personId}`;
}

/**
 * Keeps the reads of the screens between starts, for one Person at one
 * Host (`keptQuery`): it puts back what it kept, then writes each change.
 * Returns the stop, and the promise of the put back.
 */
export function keepQueries(
	queryClient: QueryClient,
	address: string,
	personId: string,
): [stop: () => void, restored: Promise<void>] {
	const key = keyOf(address, personId);
	forgotten.delete(key);
	return persistQueryClient({
		queryClient,
		persister: createAsyncStoragePersister({ storage, key }),
		maxAge: MAX_AGE_MS,
		buster: BUSTER,
		dehydrateOptions: { shouldDehydrateQuery: keptQuery },
	});
}

/** Forgets what the phone kept for one Person at one Host: they signed out. */
export function forgetKeptQueries(
	address: string,
	personId: string,
): Promise<void> {
	const key = keyOf(address, personId);
	forgotten.add(key);
	return storage.removeItem(key).catch(() => undefined);
}
