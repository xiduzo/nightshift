import { spaceIds, spaceRoster } from "@nightshift/auth";
import type { Database } from "@nightshift/db";
import { clone, project } from "@nightshift/db/schema";
import { eq, inArray } from "drizzle-orm";
import type * as Y from "yjs";
import { z } from "zod";
import type { DeviceDirectory } from "../contract";
import {
	createSyncedDocuments,
	documentId,
	documentName,
	type PersistedDocument,
	type SyncedDocuments,
} from "../documents";

/**
 * The Space document: one Yjs document per Space, named `space:<id>`, that
 * holds the Space's definitions. Members change it only through the
 * engine (the procedures check their role and the engine logs an event);
 * the relay serves it to them read-only. The Replica keeps it in `ydoc`.
 *
 * - `projects`: id → `{ name, remote, createdAt, removedAt, updatedAt }`.
 * - `clones`: `<project id>/<device id>` → `{ projectId, deviceId, addedAt }`.
 *   That a Device has a Clone, never where: the path stays in the
 *   Device's own data (its `clone` row and its Device document).
 * - `devices`: id → `{ name, updatedAt }`, for the Devices with a Clone.
 * - `offers`: the profiles Devices offer into the Space (slice 6). Empty.
 * - `members`: user id → `{ name, role }`, a mirror of the auth tables.
 *   Only this Replica writes it, from `member` and `user`.
 *
 * The document is the source of the Space's Projects. The Replica's
 * `project` rows are its projection: after every change, ours or synced,
 * the rows follow the document (`projectSpace`), so engine queries stay in
 * SQL. A projection never deletes a row and never takes a row of another
 * Space: a Project changes Space only by a move, which updates the rows
 * itself. `clone` rows stay this Device's own.
 *
 * A Space kept by a Host (`host_space`) is the Host's document: this
 * Replica receives it over its Link and projects it, but never writes it.
 * No import, no member mirror: its Members are the Host's.
 */
export type SpaceDocument = PersistedDocument & {
	readonly spaceId: string;
	/** A Host keeps this Space: the copy here only receives. */
	readonly hostedElsewhere: boolean;
	readonly projects: Y.Map<unknown>;
	readonly clones: Y.Map<unknown>;
	readonly devices: Y.Map<unknown>;
	readonly offers: Y.Map<unknown>;
	readonly members: Y.Map<unknown>;
};

export const spaceProjectSchema = z.object({
	name: z.string().min(1),
	remote: z.string().nullable(),
	createdAt: z.number(),
	removedAt: z.number().nullable(),
	updatedAt: z.number(),
});
/** A Project as the Space document holds it. */
export type SpaceProject = z.infer<typeof spaceProjectSchema>;

const spaceCloneSchema = z.object({
	projectId: z.string(),
	deviceId: z.string(),
	addedAt: z.number(),
});
/** That a Device has a Clone of a Project. No path. */
export type SpaceClone = z.infer<typeof spaceCloneSchema>;

const spaceDeviceSchema = z.object({
	name: z.string(),
	updatedAt: z.number(),
});

/** A Member as the mirror holds them. */
export type SpaceMember = { name: string; role: string };

/** The role of a Member as the document's mirror has it, or null for anyone else. */
export function memberRole(
	document: SpaceDocument,
	personId: string,
): string | null {
	const entry = document.members.get(personId) as
		| Partial<SpaceMember>
		| undefined;
	return typeof entry?.role === "string" ? entry.role : null;
}

/** The name of a Member as the document's mirror has it, or null for anyone else. */
export function memberName(
	document: SpaceDocument,
	personId: string,
): string | null {
	const entry = document.members.get(personId) as
		| Partial<SpaceMember>
		| undefined;
	return typeof entry?.name === "string" ? entry.name : null;
}

/** The name of a Device as the document has it (a Device with a Clone), or null. */
export function deviceNameIn(
	document: SpaceDocument,
	deviceId: string,
): string | null {
	const named = spaceDeviceSchema.safeParse(document.devices.get(deviceId));
	return named.success ? named.data.name : null;
}

/** The name of a Space's document. */
export function spaceDocumentName(spaceId: string): string {
	return documentName("space", spaceId);
}

/** The key of a Clone in `clones`. */
export const cloneKey = (projectId: string, deviceId: string) =>
	`${projectId}/${deviceId}`;

/** The document's Projects that this version can read, by id. */
export function spaceProjects(
	document: SpaceDocument,
): Map<string, SpaceProject> {
	const projects = new Map<string, SpaceProject>();
	for (const [id, value] of document.projects.entries()) {
		const parsed = spaceProjectSchema.safeParse(value);
		if (parsed.success) projects.set(id, parsed.data);
	}
	return projects;
}

/** The Devices with a Clone of the Project, and their names, oldest Clone first. */
export function projectClones(
	document: SpaceDocument,
	projectId: string,
): { deviceId: string; deviceName: string | null }[] {
	const clones: SpaceClone[] = [];
	for (const value of document.clones.values()) {
		const parsed = spaceCloneSchema.safeParse(value);
		if (parsed.success && parsed.data.projectId === projectId) {
			clones.push(parsed.data);
		}
	}
	return clones
		.sort((a, b) => a.addedAt - b.addedAt)
		.map(({ deviceId }) => {
			const named = spaceDeviceSchema.safeParse(document.devices.get(deviceId));
			return {
				deviceId,
				deviceName: named.success ? named.data.name : null,
			};
		});
}

/** Records, in a change, that a Device has a Clone of a Project. */
export function recordClone(
	document: SpaceDocument,
	clone: { projectId: string; deviceId: string; deviceName: string },
): void {
	const key = cloneKey(clone.projectId, clone.deviceId);
	if (!document.clones.has(key)) {
		document.clones.set(key, {
			projectId: clone.projectId,
			deviceId: clone.deviceId,
			addedAt: Date.now(),
		} satisfies SpaceClone);
	}
	const named = spaceDeviceSchema.safeParse(
		document.devices.get(clone.deviceId),
	);
	if (!named.success || named.data.name !== clone.deviceName) {
		document.devices.set(clone.deviceId, {
			name: clone.deviceName,
			updatedAt: Date.now(),
		});
	}
}

/** The Space documents of this Replica: views of its synced documents. */
export type SpaceDocuments = {
	/** The Space's document: imported and mirrored on its first open. */
	open(spaceId: string): Promise<SpaceDocument>;
	/** Opens the document of every Space this Replica knows. */
	openAll(): Promise<SpaceDocument[]>;
	/** Writes the Space's Members into its document, from the auth tables. */
	mirrorMembers(spaceId: string): Promise<void>;
	/**
	 * Removes the document of a Space this Replica no longer has: closes
	 * it, and deletes it from the Replica. Throws while the Space or a
	 * Project of it is still here.
	 */
	remove(spaceId: string): Promise<void>;
	/** Flushes every document. */
	flush(): Promise<void>;
};

/**
 * The Space documents over this Replica's synced documents. It handles
 * their kind there: on its first open a document is imported and
 * mirrored (a Space this Replica keeps) or projected (a Space a Host
 * keeps), and after every write, ours or a client's, its rows follow it.
 */
export function createSpaceDocuments(options: {
	db: Database;
	/** The names of the Devices of the Clones, and the Spaces a Host keeps. */
	directory: Pick<DeviceDirectory, "names" | "hostedElsewhere">;
	/** This Replica's synced documents. Default: its own over `db`. */
	documents?: SyncedDocuments;
}): SpaceDocuments {
	const { db, directory } = options;
	const documents = options.documents ?? createSyncedDocuments({ db });

	/** The Space document view of a persisted one. */
	async function viewOf(persisted: PersistedDocument): Promise<SpaceDocument> {
		const spaceId = documentId("space", persisted.name) as string;
		const { doc } = persisted;
		return {
			...persisted,
			spaceId,
			hostedElsewhere: await directory.hostedElsewhere(spaceId),
			projects: doc.getMap("projects"),
			clones: doc.getMap("clones"),
			devices: doc.getMap("devices"),
			offers: doc.getMap("offers"),
			members: doc.getMap("members"),
		};
	}

	documents.handle("space", {
		async opened(persisted) {
			const document = await viewOf(persisted);
			if (!document.hostedElsewhere) {
				await importRows(db, directory, document);
				await mirror(db, document);
			} else {
				// What the Link brought before this start.
				await projectSpace(db, document);
			}
		},
		// Every write, ours or a client's, is projected into the rows.
		async stored(persisted) {
			await projectSpace(db, await viewOf(persisted));
		},
	});

	async function open(spaceId: string): Promise<SpaceDocument> {
		return viewOf(await documents.open(spaceDocumentName(spaceId)));
	}

	return {
		open,
		async openAll() {
			const spaces = new Set<string>();
			for (const id of await spaceIds(db)) spaces.add(id);
			for (const row of await db
				.selectDistinct({ id: project.spaceId })
				.from(project)) {
				spaces.add(row.id);
			}
			return Promise.all([...spaces].map(open));
		},
		async mirrorMembers(spaceId) {
			const document = await open(spaceId);
			if (!document.hostedElsewhere) await mirror(db, document);
		},
		async remove(spaceId) {
			const [kept] = await db
				.select({ id: project.id })
				.from(project)
				.where(eq(project.spaceId, spaceId))
				.limit(1);
			if (kept || (await spaceIds(db)).includes(spaceId)) {
				throw new Error(`The Space ${spaceId} is still here.`);
			}
			await documents.remove(spaceDocumentName(spaceId));
		},
		flush: () => documents.flush(),
	};
}

/**
 * On the first open of a Space's document, its Projects and Clones come
 * in from the Replica's rows, once: the document records that it did.
 * An entry the document has already stays as it is.
 */
async function importRows(
	db: Database,
	directory: Pick<DeviceDirectory, "names">,
	document: SpaceDocument,
) {
	const meta = document.doc.getMap("meta");
	if (meta.get("importedAt") !== undefined) return;
	const projects = await db
		.select()
		.from(project)
		.where(eq(project.spaceId, document.spaceId));
	const rows = await db
		.select({
			projectId: clone.projectId,
			deviceId: clone.deviceId,
			createdAt: clone.createdAt,
		})
		.from(clone)
		.where(eq(clone.spaceId, document.spaceId));
	// The Clones of a Device the directory knows, with its name.
	const names = await directory.names([
		...new Set(rows.map((r) => r.deviceId)),
	]);
	const clones = rows.flatMap((row) => {
		const deviceName = names.get(row.deviceId);
		return deviceName === undefined ? [] : [{ ...row, deviceName }];
	});
	await document.change(() => {
		meta.set("spaceId", document.spaceId);
		meta.set("importedAt", Date.now());
		for (const row of projects) {
			if (document.projects.has(row.id)) continue;
			document.projects.set(row.id, projectEntry(row));
		}
		for (const row of clones) {
			const key = cloneKey(row.projectId, row.deviceId);
			if (document.clones.has(key)) continue;
			document.clones.set(key, {
				projectId: row.projectId,
				deviceId: row.deviceId,
				addedAt: row.createdAt.getTime(),
			} satisfies SpaceClone);
			if (!document.devices.has(row.deviceId)) {
				document.devices.set(row.deviceId, {
					name: row.deviceName,
					updatedAt: Date.now(),
				});
			}
		}
	});
}

/** A `project` row as a document entry. */
export function projectEntry(row: typeof project.$inferSelect): SpaceProject {
	return {
		name: row.name,
		remote: row.remote,
		createdAt: row.createdAt.getTime(),
		removedAt: row.removedAt?.getTime() ?? null,
		updatedAt: Date.now(),
	};
}

/**
 * Brings the `project` rows in line with the document: a new entry makes
 * a row, a changed one updates it (name, remote, removed). A row of
 * another Space is left alone, and so is an entry the rows refuse (a
 * remote another Project has): the next change tries again.
 */
export async function projectSpace(
	db: Database,
	document: SpaceDocument,
): Promise<void> {
	const entries = spaceProjects(document);
	if (entries.size === 0) return;
	const rows = new Map(
		(
			await db
				.select()
				.from(project)
				.where(inArray(project.id, [...entries.keys()]))
		).map((row) => [row.id, row]),
	);
	for (const [id, entry] of entries) {
		const row = rows.get(id);
		const removedAt =
			entry.removedAt === null ? null : new Date(entry.removedAt);
		try {
			if (!row) {
				await db.insert(project).values({
					id,
					spaceId: document.spaceId,
					name: entry.name,
					remote: entry.remote,
					createdAt: new Date(entry.createdAt),
					removedAt,
				});
				continue;
			}
			if (row.spaceId !== document.spaceId) continue;
			if (
				row.name === entry.name &&
				row.remote === entry.remote &&
				(row.removedAt?.getTime() ?? null) === entry.removedAt
			) {
				continue;
			}
			await db
				.update(project)
				.set({ name: entry.name, remote: entry.remote, removedAt })
				.where(eq(project.id, id));
		} catch (error) {
			console.error(
				`The project ${id} of ${document.name} was not written:`,
				error,
			);
		}
	}
}

/** Writes the Space's Members (id, name, role) when they differ from the mirror. */
async function mirror(db: Database, document: SpaceDocument): Promise<void> {
	const rows = await spaceRoster(db, document.spaceId);
	const members = new Map<string, SpaceMember>(
		rows.map((row) => [row.id, { name: row.name, role: row.role }]),
	);
	const same =
		members.size === document.members.size &&
		[...members].every(
			([id, entry]) =>
				JSON.stringify(document.members.get(id)) === JSON.stringify(entry),
		);
	if (same) return;
	await document.change(() => {
		for (const id of [...document.members.keys()]) {
			if (!members.has(id)) document.members.delete(id);
		}
		for (const [id, entry] of members) {
			if (JSON.stringify(document.members.get(id)) !== JSON.stringify(entry)) {
				document.members.set(id, entry);
			}
		}
	});
}
