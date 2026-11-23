import type { SavedCliTools } from "../../application/ports";
import { type CliToolEntry, readCliTools } from "../../domain/cli-tool";

/** The saved CLI tools in memory, for the use-case tests. It reads its entries as the document's adapter does. */
export function inMemorySavedCliTools(
	initial: Iterable<[string, unknown]> = [],
) {
	const entries = new Map<string, unknown>(initial);
	const writes: { name: string; entry: CliToolEntry | null }[] = [];
	const twin = {
		read: () => readCliTools(entries.entries()),
		async write(name: string, entry: CliToolEntry) {
			writes.push({ name, entry });
			entries.set(name, entry);
		},
		async remove(name: string) {
			writes.push({ name, entry: null });
			entries.delete(name);
		},
		/** Puts a raw entry in, as an older version or another computer wrote it. */
		put(name: string, value: unknown) {
			entries.set(name, value);
		},
		/** Every write, in order: null for a removal. */
		writes,
	};
	return twin satisfies SavedCliTools;
}
