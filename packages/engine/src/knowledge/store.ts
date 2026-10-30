import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Refusal } from "@nightshift/refusal";

/**
 * Where a Device keeps the content of knowledge files, by hash (ADR 4):
 * `<data dir>/archive/<space>/knowledge/<sha256>`, beside the archive of
 * runs. On the Space's Host it is the archive each Device copies new
 * content to. On a Device it is a cache of what it published or fetched.
 * Content never changes after it is written: a write of a hash that is
 * there already does nothing. Nothing is removed yet: retention is
 * undecided, as it is for run history.
 */

/** A file larger than this stays on the Device that has it (ADR 4, decision 9). */
export const LOCAL_ONLY_BYTES = 10 * 1024 * 1024;

/** Ids that become path segments: no separators, no dots. */
const SEGMENT = /^[\w-]{1,128}$/;
const SHA256 = /^[0-9a-f]{64}$/;

/** The hash of content, as the document and the store name it. */
export function sha256Of(content: Uint8Array): string {
	return createHash("sha256").update(content).digest("hex");
}

/** The hash of a file, read in parts: a file past 10 MB never loads whole. */
export async function sha256OfFile(path: string): Promise<string> {
	const hash = createHash("sha256");
	for await (const chunk of createReadStream(path)) hash.update(chunk);
	return hash.digest("hex");
}

/** Knowledge content on this Device, by hash. */
export type KnowledgeStore = ReturnType<typeof createKnowledgeStore>;

export function createKnowledgeStore(dataDir: string) {
	function path(spaceId: string, sha256: string): string {
		if (!SEGMENT.test(spaceId)) throw new Error(`"${spaceId}" is not an id.`);
		if (!SHA256.test(sha256)) throw new Error(`"${sha256}" is not a hash.`);
		return join(dataDir, "archive", spaceId, "knowledge", sha256);
	}

	return {
		/** The content of this hash, or null when this Device does not have it. */
		async read(spaceId: string, sha256: string): Promise<Uint8Array | null> {
			try {
				return new Uint8Array(await readFile(path(spaceId, sha256)));
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
				throw error;
			}
		},
		/**
		 * Keeps content by its hash. Refuses content that does not have
		 * that hash. Nothing happens when it is there already.
		 */
		async write(
			spaceId: string,
			sha256: string,
			content: Uint8Array,
		): Promise<void> {
			const file = path(spaceId, sha256);
			if (sha256Of(content) !== sha256) {
				throw new Refusal(
					"invalid",
					"The content does not have the hash it names.",
				);
			}
			if (await stat(file).catch(() => null)) return;
			await mkdir(dirname(file), { recursive: true });
			const temporary = `${file}.${randomUUID()}.tmp`;
			try {
				await writeFile(temporary, content);
				await rename(temporary, file);
			} finally {
				await rm(temporary, { force: true });
			}
		},
	};
}
