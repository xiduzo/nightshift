import type { Database } from "@nightshift/db";
import { project } from "@nightshift/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import {
	openPersistedDocument,
	type PersistedDocument,
} from "../device-config";
import { isKnowledgePath } from "./folder";

/**
 * The knowledge document (ADR 4): the files of a Project's knowledge, in
 * one Yjs document per Project, `knowledge:<projectId>`. Every Device of
 * the Project's Space keeps a copy in its Replica, and the relay serves
 * it beside the flow documents. The content is not in it: a Device keeps
 * each file's content by its hash (`KnowledgeStore`) and copies it to the
 * Space's Host.
 *
 * `files`: path → `{ sha256, size, changedAt, deviceId, local? }`, one
 * plain value per path. Entries merge per path: when two Devices change
 * one path, Yjs keeps one of them, and the next reconcile makes the later
 * change win (`createKnowledgeSync`). `local`: the file is larger than
 * 10 MB and stays on the Device that has it.
 */

/** One file of the knowledge, as the document lists it. */
export type KnowledgeEntry = {
	/** The hash of its content: where the content is kept. */
	sha256: string;
	/** Bytes. */
	size: number;
	/** Epoch ms: when the Device that changed it last changed it. */
	changedAt: number;
	/** The Device that changed it last. */
	deviceId: string;
	/** Larger than 10 MB: it stays on `deviceId`, and other Devices do not fetch it. */
	local?: true;
};

const entrySchema = z.object({
	sha256: z.string().regex(/^[0-9a-f]{64}$/),
	size: z.number().int().min(0),
	changedAt: z.number().finite(),
	deviceId: z.string().min(1),
	local: z.literal(true).optional(),
});

/** The transaction origin of this Replica's own changes. */
const KNOWLEDGE_ORIGIN = Symbol("knowledge-document-owner");

/** The name of a Project's knowledge document. */
export function knowledgeDocumentName(projectId: string): string {
	return `knowledge:${projectId}`;
}

/** The Project of a knowledge document's name, or null for another kind. */
export function knowledgeDocumentProject(name: string): string | null {
	return name.startsWith("knowledge:")
		? name.slice("knowledge:".length) || null
		: null;
}

/** The document's `files`: path → entry. */
export function knowledgeFiles(document: PersistedDocument) {
	return document.doc.getMap<unknown>("files");
}

/** Every valid entry of the document, by path. */
export function knowledgeEntries(
	document: PersistedDocument,
): Map<string, KnowledgeEntry> {
	const entries = new Map<string, KnowledgeEntry>();
	for (const [path, value] of knowledgeFiles(document).entries()) {
		if (!isKnowledgePath(path)) continue;
		const parsed = entrySchema.safeParse(value);
		if (!parsed.success) continue;
		const { local, ...entry } = parsed.data;
		entries.set(path, local ? { ...entry, local } : entry);
	}
	return entries;
}

/** The knowledge documents this Replica holds, opened once each. */
export type KnowledgeDocuments = {
	/** The Project's knowledge document. */
	open(projectId: string): Promise<PersistedDocument>;
	/** Opens the documents of every Project this Replica knows. */
	openAll(): Promise<PersistedDocument[]>;
	/**
	 * A document by its name, for the relay: opened when its Project is
	 * one this Replica has. Null for another name.
	 */
	find(name: string): Promise<PersistedDocument | null>;
	/** Flushes every document. */
	flush(): Promise<void>;
	close(): Promise<void>;
};

export function createKnowledgeDocuments(options: {
	db: Database;
}): KnowledgeDocuments {
	const { db } = options;
	const opening = new Map<string, Promise<PersistedDocument>>();
	const opened = new Map<string, PersistedDocument>();

	function open(projectId: string): Promise<PersistedDocument> {
		let found = opening.get(projectId);
		if (!found) {
			found = openPersistedDocument({
				db,
				name: knowledgeDocumentName(projectId),
				origin: KNOWLEDGE_ORIGIN,
				label: "The knowledge document",
			}).then((document) => {
				opened.set(document.name, document);
				return document;
			});
			opening.set(projectId, found);
			found.catch(() => opening.delete(projectId));
		}
		return found;
	}

	return {
		open,
		async openAll() {
			const rows = await db.select({ id: project.id }).from(project);
			return Promise.all(rows.map((row) => open(row.id)));
		},
		async find(name) {
			const known = opened.get(name);
			if (known) return known;
			const projectId = knowledgeDocumentProject(name);
			if (projectId === null) return null;
			const [row] = await db
				.select({ id: project.id })
				.from(project)
				.where(eq(project.id, projectId));
			return row ? open(projectId) : null;
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
