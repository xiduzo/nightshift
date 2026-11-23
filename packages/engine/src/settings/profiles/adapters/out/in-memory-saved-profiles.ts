import type { SavedProfiles } from "../../application/ports";
import { type ProfileEntry, readProfiles } from "../../domain/profile-entries";

/** The saved profiles in memory, for the use-case tests. It reads its entries as the document's adapter does. */
export function inMemorySavedProfiles(
	initial: Iterable<[string, unknown]> = [],
) {
	const entries = new Map<string, unknown>(initial);
	const writes: { id: string; entry: ProfileEntry | null }[] = [];
	const twin = {
		read: () => readProfiles(entries.entries()),
		async write(id: string, entry: ProfileEntry) {
			writes.push({ id, entry });
			entries.set(id, entry);
		},
		async remove(id: string) {
			writes.push({ id, entry: null });
			entries.delete(id);
		},
		/** Puts a raw entry in, as an older version or another computer wrote it. */
		put(id: string, value: unknown) {
			entries.set(id, value);
		},
		/** Every write, in order: null for a removal. */
		writes,
	};
	return twin satisfies SavedProfiles;
}
