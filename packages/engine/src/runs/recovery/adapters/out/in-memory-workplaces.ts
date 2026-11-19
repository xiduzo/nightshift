import type { Workplaces } from "../../application/ports";

/**
 * The folders runs work in, in memory. A test puts a folder (`folder`) or
 * a file (`file`) at a path, and reads which paths were asked (`asked`).
 */
export function inMemoryWorkplaces() {
	const folders = new Set<string>();
	const files = new Set<string>();
	const twin = {
		/** Every path asked, in order. */
		asked: [] as string[],
		folder(path: string) {
			folders.add(path);
		},
		file(path: string) {
			files.add(path);
		},
		async there(path: string) {
			twin.asked.push(path);
			return folders.has(path);
		},
	};
	return twin satisfies Workplaces;
}

export type InMemoryWorkplaces = ReturnType<typeof inMemoryWorkplaces>;
