import type { Dirent } from "node:fs";
import { readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { writeWhole } from "../../../../archive";
import type { ReadMarks } from "../../application/ports";
import type { KeptRead } from "../../domain/page-read";

/**
 * What the last read of each page saw, per project, on this computer: the
 * mark a later read compares with (`ReadMark`), and the page's links, so a
 * crawl that finds a page unchanged still follows them. A file per project
 * in `<dataDir>/knowledge/.reads/`, next to the search index: like the
 * index, it is this computer's own cache of the knowledge, not part of it.
 * It does not sync: another computer reads a page whole the first time.
 * Losing it costs one whole read of each page, nothing more.
 *
 * The marks of each reader are apart: a page Jina Reader read is new to
 * Firecrawl.
 */

/** How many pages a project keeps marks of. The oldest go first. */
const MAX_PAGES = 5_000;

/** How many links of a page are kept. */
const MAX_LINKS = 1_000;

/** How long a change waits before it is written, so a crawl writes the file now and then. */
const WRITE_AFTER_MS = 2_000;

const markSchema = z.object({
	etag: z.string().optional(),
	lastModified: z.string().optional(),
	fingerprint: z.string(),
});

const entrySchema = z.object({
	mark: markSchema,
	links: z.array(z.string()),
});

const fileSchema = z.record(z.string(), entrySchema);

/** The end of the name of a part file that a failed save left before c494f0259. */
const OLD_PART = ".json.part";

/**
 * Removes the part files that a failed save of the marks left in `root`
 * before the marks were written whole (c494f0259), and logs how many. No
 * new one appears. Every other file stays.
 */
async function removeOldParts(root: string): Promise<void> {
	let entries: Dirent[];
	try {
		entries = await readdir(root, { withFileTypes: true });
	} catch {
		return; // No folder yet: no part file either.
	}
	const parts = entries.filter(
		(entry) => entry.isFile() && entry.name.endsWith(OLD_PART),
	);
	let removed = 0;
	for (const part of parts) {
		try {
			await rm(join(root, part.name));
			removed++;
		} catch (error) {
			console.warn(
				`An old part file of the page read marks stays: ${part.name}`,
				error,
			);
		}
	}
	if (removed > 0) {
		console.info(
			`Removed ${removed} old part file${removed === 1 ? "" : "s"} (*${OLD_PART}) of the page read marks from ${root}.`,
		);
	}
}

export function fsReadMarks(dataDir: string): ReadMarks {
	const root = join(dataDir, "knowledge", ".reads");
	const loaded = new Map<string, Map<string, KeptRead>>();
	const dirty = new Set<string>();
	let timer: ReturnType<typeof setTimeout> | null = null;
	let swept: Promise<void> | null = null;

	const keyOf = (reader: string, url: string) => `${reader} ${url}`;
	const fileOf = (projectId: string) =>
		join(root, `${projectId.replace(/[^\w-]/g, "_")}.json`);

	async function load(projectId: string): Promise<Map<string, KeptRead>> {
		const kept = loaded.get(projectId);
		if (kept) return kept;
		swept ??= removeOldParts(root);
		await swept;
		let entries = new Map<string, KeptRead>();
		try {
			const parsed = fileSchema.safeParse(
				JSON.parse(await readFile(fileOf(projectId), "utf8")),
			);
			if (parsed.success) entries = new Map(Object.entries(parsed.data));
		} catch {
			// No file yet, or one that does not read: every page is new.
		}
		loaded.set(projectId, entries);
		return entries;
	}

	async function write(projectId: string): Promise<void> {
		const entries = loaded.get(projectId);
		if (!entries) return;
		await writeWhole(
			fileOf(projectId),
			JSON.stringify(Object.fromEntries(entries)),
		);
	}

	async function flush(): Promise<void> {
		if (timer) clearTimeout(timer);
		timer = null;
		const projects = [...dirty];
		dirty.clear();
		for (const projectId of projects) {
			await write(projectId).catch((error) => {
				console.warn("The marks of the page reads were not saved:", error);
			});
		}
	}

	return {
		async get(projectId, reader, url) {
			return (await load(projectId)).get(keyOf(reader, url)) ?? null;
		},
		async set(projectId, reader, url, kept) {
			const entries = await load(projectId);
			const key = keyOf(reader, url);
			// The latest at the end: the oldest goes first.
			entries.delete(key);
			entries.set(key, {
				mark: { ...kept.mark },
				links: kept.links.slice(0, MAX_LINKS),
			});
			for (const old of entries.keys()) {
				if (entries.size <= MAX_PAGES) break;
				entries.delete(old);
			}
			dirty.add(projectId);
			if (!timer) {
				timer = setTimeout(() => {
					flush().catch(() => {});
				}, WRITE_AFTER_MS);
				timer.unref?.();
			}
		},
		flush,
	};
}
