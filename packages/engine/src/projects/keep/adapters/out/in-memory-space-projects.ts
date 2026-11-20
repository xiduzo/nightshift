import { instant, instantOrNull } from "@nightshift/time";
import type { SpaceProjects } from "../../application/ports";
import type {
	CloneRecord,
	MovingProject,
	NewProjectEntry,
} from "../../domain/project";

/**
 * `SpaceProjects` in memory: each Space document's Project entries, Clones
 * and Device names, and the Spaces a Host keeps (their documents never
 * change here). Every write is one change: `changes` counts them. Test code.
 */

export type MemoryProjectEntry = NewProjectEntry & {
	createdAt: number;
	removedAt: number | null;
};

export type MemorySpaceDocument = {
	projects: Map<string, MemoryProjectEntry>;
	/** The Clones, oldest first. */
	clones: { projectId: string; deviceId: string }[];
	/** The Device names. */
	devices: Map<string, string>;
};

export type SpaceProjectRecords = {
	documents: Map<string, MemorySpaceDocument>;
	/** The Spaces another Replica keeps. */
	hostedElsewhere: Set<string>;
	/** One line per change of a document: `<spaceId>`. */
	changes: string[];
};

export function spaceProjectRecords(): SpaceProjectRecords {
	return { documents: new Map(), hostedElsewhere: new Set(), changes: [] };
}

export function inMemorySpaceProjects(
	records: SpaceProjectRecords = spaceProjectRecords(),
	/** The projection of an entry into its row, as the real documents have it. */
	projected: (
		spaceId: string,
		projectId: string,
		entry: MemoryProjectEntry,
	) => void = () => {},
) {
	let clock = 0;
	const documentOf = (spaceId: string) => {
		let document = records.documents.get(spaceId);
		if (!document) {
			document = { projects: new Map(), clones: [], devices: new Map() };
			records.documents.set(spaceId, document);
		}
		return document;
	};
	const withoutFolder = (document: MemorySpaceDocument, projectId: string) =>
		document.projects.get(projectId)?.folder === false;
	const record = (document: MemorySpaceDocument, clone: CloneRecord) => {
		if (withoutFolder(document, clone.projectId)) return;
		const has = document.clones.some(
			(c) => c.projectId === clone.projectId && c.deviceId === clone.deviceId,
		);
		if (!has) {
			document.clones.push({
				projectId: clone.projectId,
				deviceId: clone.deviceId,
			});
		}
		document.devices.set(clone.deviceId, clone.deviceName);
	};
	const changed = (spaceId: string) => {
		records.changes.push(spaceId);
		for (const [id, entry] of documentOf(spaceId).projects) {
			projected(spaceId, id, entry);
		}
	};

	const twin = {
		records,
		documentOf,
		/** A Space another Replica keeps. */
		hostElsewhere(spaceId: string) {
			records.hostedElsewhere.add(spaceId);
		},

		async define(
			row: Parameters<SpaceProjects["define"]>[0],
			change: Parameters<SpaceProjects["define"]>[1],
		) {
			if (records.hostedElsewhere.has(row.spaceId)) return false;
			const document = documentOf(row.spaceId);
			const entry = document.projects.get(row.id) ?? {
				name: row.name,
				remote: row.remote,
				folder: row.folder,
				createdAt: instant(row.createdAt),
				removedAt: instantOrNull(row.removedAt),
			};
			const { removed, ...rest } = change;
			document.projects.set(row.id, {
				...entry,
				...rest,
				...(removed === undefined
					? {}
					: { removedAt: removed ? ++clock : null }),
			});
			changed(row.spaceId);
			return true;
		},
		async create(spaceId: string, projectId: string, entry: NewProjectEntry) {
			if (records.hostedElsewhere.has(spaceId)) return false;
			documentOf(spaceId).projects.set(projectId, {
				...entry,
				createdAt: ++clock,
				removedAt: null,
			});
			changed(spaceId);
			return true;
		},
		async recordCloneHere(spaceId: string, clone: CloneRecord) {
			if (records.hostedElsewhere.has(spaceId)) return false;
			record(documentOf(spaceId), clone);
			changed(spaceId);
			return true;
		},
		async recordClone(spaceId: string, clone: CloneRecord) {
			const document = documentOf(spaceId);
			if (
				records.hostedElsewhere.has(spaceId) ||
				!document.projects.has(clone.projectId)
			) {
				return "unknown" as const;
			}
			if (withoutFolder(document, clone.projectId)) {
				return "without-folder" as const;
			}
			record(document, clone);
			changed(spaceId);
			return "recorded" as const;
		},
		async setClones(
			spaceId: string,
			input: {
				deviceId: string;
				deviceName: string;
				projectIds: readonly string[];
			},
		) {
			if (records.hostedElsewhere.has(spaceId)) return null;
			const document = documentOf(spaceId);
			const has = new Set(
				input.projectIds.filter(
					(id) => document.projects.has(id) && !withoutFolder(document, id),
				),
			);
			const known = new Set(
				document.clones
					.filter((c) => c.deviceId === input.deviceId)
					.map((c) => c.projectId),
			);
			const added = [...has].filter((id) => !known.has(id));
			const removed = [...known].filter((id) => !has.has(id));
			const named = document.devices.get(input.deviceId) ?? null;
			const rename = has.size > 0 && named !== input.deviceName;
			if (added.length === 0 && removed.length === 0 && !rename) {
				return { added, removed };
			}
			document.clones = document.clones.filter(
				(c) => c.deviceId !== input.deviceId || !removed.includes(c.projectId),
			);
			for (const projectId of has) record(document, { ...input, projectId });
			changed(spaceId);
			return { added, removed };
		},
		async take(
			spaceId: string,
			taken: {
				define?: readonly Omit<MovingProject, "spaceId">[];
				restore?: readonly string[];
				clones?: readonly CloneRecord[];
			},
		) {
			if (records.hostedElsewhere.has(spaceId)) return;
			const document = documentOf(spaceId);
			for (const {
				id,
				name,
				remote,
				folder,
				createdAt,
				removedAt,
			} of taken.define ?? []) {
				if (document.projects.has(id)) continue;
				document.projects.set(id, {
					name,
					remote,
					folder,
					createdAt,
					removedAt,
				});
			}
			for (const id of taken.restore ?? []) {
				const entry = document.projects.get(id);
				if (entry) entry.removedAt = null;
			}
			for (const clone of taken.clones ?? []) record(document, clone);
			changed(spaceId);
		},
		async forgetDevice(deviceId: string) {
			for (const [spaceId, document] of records.documents) {
				if (records.hostedElsewhere.has(spaceId)) continue;
				const clones = document.clones.filter((c) => c.deviceId === deviceId);
				const named = document.devices.has(deviceId);
				if (clones.length === 0 && !named) continue;
				document.clones = document.clones.filter(
					(c) => c.deviceId !== deviceId,
				);
				document.devices.delete(deviceId);
				changed(spaceId);
			}
		},
		async clones(spaceId: string, projectIds: readonly string[]) {
			const document = documentOf(spaceId);
			return new Map(
				projectIds.map((id) => [
					id,
					document.clones
						.filter((c) => c.projectId === id)
						.map((c) => ({
							deviceId: c.deviceId,
							deviceName: document.devices.get(c.deviceId) ?? null,
						})),
				]),
			);
		},
	};
	return twin satisfies SpaceProjects;
}

export type InMemorySpaceProjects = ReturnType<typeof inMemorySpaceProjects>;
