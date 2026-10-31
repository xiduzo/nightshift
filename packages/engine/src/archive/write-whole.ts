import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

/**
 * Writes a file whole or not at all: to a hidden file beside it, then a
 * rename. A reader never sees half of it, and a walk of the folder at the
 * same time skips the hidden file. Makes the folder when it is not there.
 */
export async function writeWhole(
	path: string,
	content: string | Uint8Array,
): Promise<void> {
	const dir = dirname(path);
	await mkdir(dir, { recursive: true });
	const temporary = join(dir, `.${basename(path)}.${randomUUID()}.tmp`);
	try {
		await writeFile(temporary, content);
		await rename(temporary, path);
	} finally {
		await rm(temporary, { force: true });
	}
}
