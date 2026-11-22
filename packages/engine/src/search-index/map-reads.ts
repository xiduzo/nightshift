import type { Database } from "bun:sqlite";
import { modelOfVectors } from "./tables";

/**
 * What the Map reads of the search index: the text of the sections, the
 * vectors, and a stamp that changes when either would read something else.
 */

/**
 * The sections of the project's files with text, by path and in order,
 * up to `maxBytes` in all and `maxBytesPerFile` of a file, and how many
 * files that left out. Whole sections: the Map counts their words.
 */
export function sectionTexts(
	sqlite: Database,
	projectId: string,
	limits: { maxBytes: number; maxBytesPerFile: number },
): {
	read: { path: string; sections: string[] }[];
	filesLeftOut: number;
} {
	const read: { path: string; sections: string[] }[] = [];
	let left = limits.maxBytes;
	let inFile = 0;
	// Its own statement: this stops halfway, and a kept statement that
	// stopped halfway cannot run again.
	const sections = sqlite.prepare<{ path: string; text: string }, [string]>(
		`SELECT f.path AS path, s.text AS text
		FROM sections s JOIN files f ON f.id = s.file_id
		WHERE f.project_id = ? AND s.text != ''
		ORDER BY f.path, s.ord`,
	);
	try {
		for (const row of sections.iterate(projectId)) {
			if (read.at(-1)?.path !== row.path) {
				// The next file does not fit: the rest stays out.
				if (left <= 0) break;
				read.push({ path: row.path, sections: [] });
				inFile = 0;
			}
			if (inFile >= limits.maxBytesPerFile) continue;
			const size = Buffer.byteLength(row.text);
			inFile += size;
			left -= size;
			read.at(-1)?.sections.push(row.text);
		}
	} finally {
		sections.finalize();
	}
	const all =
		sqlite
			.query<{ n: number }, [string]>(
				`SELECT count(DISTINCT f.id) AS n
				FROM sections s JOIN files f ON f.id = s.file_id
				WHERE f.project_id = ? AND s.text != ''`,
			)
			.get(projectId)?.n ?? 0;
	return { read, filesLeftOut: Math.max(0, all - read.length) };
}
/**
 * What changes when `sectionTexts` or `storedVectors` would read something
 * else: each file by its content, and which vectors there are. A section's
 * vector never changes while its file stays, so the vectors' count and
 * newest row are enough. It reads no section and no vector.
 */
export function mapStamp(sqlite: Database, projectId: string): string {
	return JSON.stringify([
		sqlite
			.query<{ path: string; sha256: string }, [string]>(
				"SELECT path, sha256 FROM files WHERE project_id = ? ORDER BY path",
			)
			.all(projectId)
			.map(({ path, sha256 }) => [path, sha256]),
		sqlite
			.query<{ n: number; newest: number | null }, [string]>(
				"SELECT count(*) AS n, max(rowid) AS newest FROM vectors WHERE project_id = ?",
			)
			.get(projectId),
		sqlite
			.query<{ value: string }, []>(
				"SELECT value FROM meta WHERE key = 'model'",
			)
			.get()?.value ?? null,
	]);
}
/**
 * The vectors of this model that still belong to a section of a file, at
 * most `limit`: the first section of each file, then the second of each,
 * so a cut leaves no file out. By path, from the store's own table: it
 * reads no model, and it changes nothing. Another model's vectors: none.
 */
export function storedVectors(
	sqlite: Database,
	projectId: string,
	model: string,
	limit: number,
): { path: string; vector: Float32Array }[] {
	if (modelOfVectors(sqlite) !== model) return [];
	return sqlite
		.query<{ path: string; vec: Uint8Array }, [string, number]>(
			`WITH held AS (
				SELECT v.rowid AS row, f.path AS path, min(s.ord) AS ord
				FROM vectors v
				JOIN files f ON f.project_id = v.project_id AND f.path = json_extract(v.metadata, '$.path')
				JOIN sections s ON s.file_id = f.id AND s.section_id = json_extract(v.metadata, '$.section_id')
				WHERE v.project_id = ?
				GROUP BY v.rowid
			), ranked AS (
				SELECT row, path, row_number() OVER (PARTITION BY path ORDER BY ord) AS nth FROM held
			)
			SELECT r.path AS path, v.vec AS vec
			FROM ranked r JOIN vectors v ON v.rowid = r.row
			ORDER BY r.nth, r.path LIMIT ?`,
		)
		.all(projectId, limit)
		.map(({ path, vec }) => ({
			path,
			vector: new Float32Array(vec.slice().buffer),
		}));
}
