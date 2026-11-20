import type { SpaceEntries } from "../../application/ports";

/**
 * The Space documents of a move in memory: each Space's Project entries
 * and Clones, and the Spaces a Host keeps (their documents never change
 * here). It records each call. Test code.
 */

export type MemoryEntry = { name: string; remote: string | null };

export type MemoryDocument = {
	projects: Map<string, MemoryEntry>;
	/** The Clones: `[projectId, deviceId]`, oldest first. */
	clones: [string, string][];
};

export type EntryRecords = {
	documents: Map<string, MemoryDocument>;
	/** The Spaces another Replica keeps. */
	hostedElsewhere: Set<string>;
	/** What the move asked, in order: `move <from>` or `forget <spaceId>`. */
	calls: string[];
};

export function entryRecords(): EntryRecords {
	return { documents: new Map(), hostedElsewhere: new Set(), calls: [] };
}

function documentOf(records: EntryRecords, spaceId: string): MemoryDocument {
	let document = records.documents.get(spaceId);
	if (!document) {
		document = { projects: new Map(), clones: [] };
		records.documents.set(spaceId, document);
	}
	return document;
}

export function inMemorySpaceEntries(
	records: EntryRecords = entryRecords(),
): SpaceEntries {
	return {
		async move(move) {
			records.calls.push(`move ${move.from}`);
			const source = documentOf(records, move.from);
			const pairs = Object.entries(move.projects);
			const clonesOf = (id: string) =>
				source.clones.filter(
					([projectId, deviceId]) =>
						projectId === id &&
						(move.onlyDevice === undefined || deviceId === move.onlyDevice),
				);
			for (const spaceId of new Set(pairs.map(([, t]) => t.spaceId))) {
				if (records.hostedElsewhere.has(spaceId)) continue;
				const destination = documentOf(records, spaceId);
				for (const [id, target] of pairs) {
					if (target.spaceId !== spaceId) continue;
					if (
						id === target.projectId ||
						!destination.projects.has(target.projectId)
					) {
						const row = move.rows.get(id);
						const entry =
							source.projects.get(id) ??
							(row ? { name: row.name, remote: row.remote } : null);
						if (entry) destination.projects.set(target.projectId, { ...entry });
					}
					for (const [, deviceId] of clonesOf(id)) {
						const has = destination.clones.some(
							([p, d]) => p === target.projectId && d === deviceId,
						);
						if (!has) destination.clones.push([target.projectId, deviceId]);
					}
				}
			}
			if (records.hostedElsewhere.has(move.from)) return;
			if (move.onlyDevice !== undefined) return;
			for (const [id] of pairs) {
				source.projects.delete(id);
				source.clones = source.clones.filter(([p]) => p !== id);
			}
		},
		async forget(spaceId) {
			records.calls.push(`forget ${spaceId}`);
			records.documents.delete(spaceId);
		},
	};
}
