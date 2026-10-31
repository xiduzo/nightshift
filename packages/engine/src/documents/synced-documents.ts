import type { DocumentOf } from "@nightshift/auth";
import { spaceIds } from "@nightshift/auth";
import type { Database } from "@nightshift/db";
import { project, ydoc } from "@nightshift/db/schema";
import { eq } from "drizzle-orm";
import { openPersistedDocument, type PersistedDocument } from "./ydoc";

/**
 * The Yjs documents this Replica syncs, by name: one module per Replica
 * that opens each once, finds it for the relay, tells its kind and its
 * Space, lists the documents of a Space, and flushes and closes them all.
 * Each is a `PersistedDocument` in the Replica's `ydoc` table. The typed
 * views stay in their verticals and take their documents from here: the
 * flow document (`createFlowDocuments`), the knowledge document
 * (`createKnowledgeDocuments`), the Space document
 * (`createSpaceDocuments`), the copies of other Devices' documents
 * (`createDeviceCopies`) and this Device's document
 * (`openDeviceDocument`).
 *
 * The name of a document says its kind and the id it belongs to:
 *
 * - `device:<id>`: a Device's document. This Replica opens its own. On a
 *   Host, the relay serves those it keeps for the Devices whose home it
 *   is from their rows, without this module.
 * - `device-copy:<id>`: this Replica's copy of another Device's document
 *   of its owner. It syncs as `device:<id>`: apart from the rows a Host
 *   keeps under that name.
 * - `space:<id>`: a Space's document.
 * - `flows:<project id>`, `flows-history:<project id>`: a Project's flows
 *   and schedules, and their revisions (ADR 2).
 * - `knowledge:<project id>`: a Project's knowledge files by hash (ADR 4).
 *
 * Adding a kind is one entry in `KINDS` and its view.
 */
export type SyncedDocuments = {
	/** The document of this name, opened once. Throws for a name of no kind. */
	open(name: string): Promise<PersistedDocument>;
	/**
	 * The document of this name when this Replica has it, for the relay:
	 * an open one, or a document of a Project or a Space it has (opened
	 * then). Null for any other name.
	 */
	find(name: string): Promise<PersistedDocument | null>;
	/**
	 * What the access rules need of a name: the Device of a Device
	 * document, or the Space of a Space document and of a Project's
	 * document. Null for another name, and for a Project this Replica
	 * does not have.
	 */
	documentOf(name: string): Promise<DocumentOf | null>;
	/**
	 * The documents of a Space: its Space document, then the flow, flow
	 * history and knowledge documents of each of its Projects here.
	 */
	ofSpace(spaceId: string): Promise<PersistedDocument[]>;
	/** Opens the document of every Space and every Project this Replica has. */
	openAll(): Promise<void>;
	/**
	 * What a view does with each document of a kind: once when it opens
	 * (before `open` resolves), and after each write to the Replica (a
	 * change resolves when it is done). One per kind: a later call
	 * replaces it, as after a `bun --hot` reload.
	 */
	handle(
		kind: DocumentKind,
		hooks: {
			opened?(document: PersistedDocument): Promise<void>;
			stored?(document: PersistedDocument): Promise<void>;
		},
	): void;
	/** Closes a document and deletes it from the Replica. */
	remove(name: string): Promise<void>;
	/** Flushes every open document. */
	flush(): Promise<void>;
	/** Flushes, then closes every open document. */
	close(): Promise<void>;
};

/** The kinds of document, by the prefix of their names. */
const KINDS = {
	device: { prefix: "device:", label: "The Device document" },
	"device-copy": {
		prefix: "device-copy:",
		label: "The copy of the Device document",
	},
	space: { prefix: "space:", label: "The Space document" },
	flows: { prefix: "flows:", label: "The flow document" },
	"flows-history": { prefix: "flows-history:", label: "The flow history" },
	knowledge: { prefix: "knowledge:", label: "The knowledge document" },
} as const;

export type DocumentKind = keyof typeof KINDS;

/** The kinds of a Project's documents. */
const PROJECT_KINDS = ["flows", "flows-history", "knowledge"] as const;

/** The transaction origin of this Replica's own changes, per kind. */
const ORIGINS = Object.fromEntries(
	Object.keys(KINDS).map((kind) => [kind, Symbol(`${kind}-document-owner`)]),
) as Record<DocumentKind, symbol>;

/** The name of a document of this kind for this id. */
export function documentName(kind: DocumentKind, id: string): string {
	return `${KINDS[kind].prefix}${id}`;
}

/** The kind of a document and its id, by its name. Null for a name of no kind. */
export function documentKind(
	name: string,
): { kind: DocumentKind; id: string } | null {
	for (const [kind, { prefix }] of Object.entries(KINDS)) {
		if (!name.startsWith(prefix)) continue;
		const id = name.slice(prefix.length);
		return id === "" ? null : { kind: kind as DocumentKind, id };
	}
	return null;
}

/** The id of a document of this kind, by its name. Null for another kind. */
export function documentId(kind: DocumentKind, name: string): string | null {
	const found = documentKind(name);
	return found?.kind === kind ? found.id : null;
}

export function createSyncedDocuments(options: {
	db: Database;
}): SyncedDocuments {
	const { db } = options;
	const opening = new Map<string, Promise<PersistedDocument>>();
	const opened = new Map<string, PersistedDocument>();
	const hooks = new Map<
		DocumentKind,
		Parameters<SyncedDocuments["handle"]>[1]
	>();

	async function openOne(
		name: string,
		kind: DocumentKind,
	): Promise<PersistedDocument> {
		const holder: { document?: PersistedDocument } = {};
		const document = await openPersistedDocument({
			db,
			name,
			origin: ORIGINS[kind],
			label: KINDS[kind].label,
			afterStore: async () => {
				const stored = hooks.get(kind)?.stored;
				if (holder.document && stored) await stored(holder.document);
			},
		});
		holder.document = document;
		await hooks.get(kind)?.opened?.(document);
		opened.set(name, document);
		return document;
	}

	function open(name: string): Promise<PersistedDocument> {
		let found = opening.get(name);
		if (!found) {
			const kind = documentKind(name)?.kind;
			if (!kind) return Promise.reject(new Error(`No document ${name}.`));
			found = openOne(name, kind);
			opening.set(name, found);
			found.catch(() => opening.delete(name));
		}
		return found;
	}

	async function projectSpace(projectId: string): Promise<string | null> {
		const [row] = await db
			.select({ spaceId: project.spaceId })
			.from(project)
			.where(eq(project.id, projectId));
		return row?.spaceId ?? null;
	}

	/** Every Space this Replica has: its own, and those of its Projects. */
	async function spaces(): Promise<string[]> {
		const found = new Set(await spaceIds(db));
		for (const row of await db
			.selectDistinct({ id: project.spaceId })
			.from(project)) {
			found.add(row.id);
		}
		return [...found];
	}

	async function projectDocuments(projectIds: readonly string[]) {
		return Promise.all(
			[...projectIds]
				.sort()
				.flatMap((id) =>
					PROJECT_KINDS.map((kind) => open(documentName(kind, id))),
				),
		);
	}

	return {
		open,
		async find(name) {
			const known = opened.get(name);
			if (known) return known;
			const found = documentKind(name);
			if (!found) return null;
			if (found.kind === "space") {
				return (await spaces()).includes(found.id) ? open(name) : null;
			}
			if (!(PROJECT_KINDS as readonly string[]).includes(found.kind)) {
				return null;
			}
			return (await projectSpace(found.id)) !== null ? open(name) : null;
		},
		async documentOf(name) {
			const found = documentKind(name);
			if (!found) return null;
			if (found.kind === "device")
				return { kind: "device", deviceId: found.id };
			if (found.kind === "space") return { kind: "space", spaceId: found.id };
			if (found.kind === "device-copy") return null;
			const spaceId = await projectSpace(found.id);
			if (spaceId === null) return null;
			return {
				kind: found.kind === "knowledge" ? "knowledge" : "flows",
				spaceId,
			};
		},
		async ofSpace(spaceId) {
			const space = await open(documentName("space", spaceId));
			// Its Projects as its rows have them: once what it holds is projected.
			await space.flush();
			const rows = await db
				.select({ id: project.id })
				.from(project)
				.where(eq(project.spaceId, spaceId));
			return [space, ...(await projectDocuments(rows.map((r) => r.id)))];
		},
		async openAll() {
			await Promise.all(
				(await spaces()).map((id) => open(documentName("space", id))),
			);
			const rows = await db.select({ id: project.id }).from(project);
			await projectDocuments(rows.map((r) => r.id));
		},
		handle(kind, next) {
			hooks.set(kind, next);
		},
		async remove(name) {
			const pending = opening.get(name);
			opening.delete(name);
			opened.delete(name);
			const document = await pending?.catch(() => null);
			await document?.close();
			await db.delete(ydoc).where(eq(ydoc.name, name));
		},
		async flush() {
			await Promise.all([...opened.values()].map((d) => d.flush()));
		},
		async close() {
			await Promise.all([...opened.values()].map((d) => d.close()));
			opened.clear();
			opening.clear();
		},
	};
}
