import { mkdir, readFile, stat, utimes, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { project } from "@nightshift/db/schema";
import * as Y from "yjs";
import { type ArchiveHost, createSpaceArchive } from "../archive";
import { createSyncedDocuments, documentName } from "../documents";
import { wireFiles } from "../knowledge/files";
import { fsKnowledgeFolders } from "../knowledge/files/adapters/out/fs-knowledge-folders";
import { wireLearnings } from "../knowledge/learnings";
import { isMarkdown, markdownHeadings } from "../knowledge/search";
import { createKnowledgeFolderLocks, wireSync } from "../knowledge/sync";
import { createOlderHosts } from "../knowledge/sync/domain/older-hosts";
import { createSandbox, type Sandbox } from "./test-support";

/**
 * Devices with a project's knowledge, and a Host in memory between them,
 * for the tests of the merge and the reader. The documents sync by hand,
 * as a Link does. A sandbox's database is real, and so is each Yjs
 * document: they are fast enough, so the document needs no second adapter.
 */

/** A Host's archive in memory: content by hash. `down` is the network gone. */
export function memoryHost() {
	const kept = new Map<string, Uint8Array>();
	const state = { down: false };
	const host: ArchiveHost = {
		async archivePut({ ref, content }) {
			if (state.down) throw new TypeError("The network connection was lost.");
			if (ref.kind !== "content" || typeof content === "string") return false;
			kept.set(ref.sha256, content.slice());
			return true;
		},
		async archiveGet(ref) {
			if (state.down) throw new TypeError("The network connection was lost.");
			if (ref.kind !== "content") return null;
			return kept.get(ref.sha256)?.slice() ?? null;
		},
	};
	return { kept, state, host };
}

const sandboxes: Sandbox[] = [];

/** Removes the sandboxes of the devices so far: for `afterEach`. */
export async function removeKnowledgeDevices(): Promise<void> {
	await Promise.all(sandboxes.splice(0).map((s) => s.cleanup()));
}

/** A Device with project p1 and its knowledge, reaching `host`. */
export async function knowledgeDevice(
	host: ArchiveHost | null,
	options: { pageWaitMs?: number } = {},
) {
	const sandbox = await createSandbox();
	sandboxes.push(sandbox);
	await sandbox.db
		.insert(project)
		.values({ id: "p1", spaceId: sandbox.spaceId, name: "p1" });
	const folders = fsKnowledgeFolders(sandbox.dataDir);
	const synced = createSyncedDocuments({ db: sandbox.db });
	const archive = createSpaceArchive(sandbox.dataDir);
	if (host) archive.connect(host);
	const locks = createKnowledgeFolderLocks();
	/** Which Hosts run an older version: every instance of this Device shares it. */
	const older = createOlderHosts();
	/** One more instance over this Device's folder and documents. */
	const newSync = (
		options: { locks?: typeof locks; inStep?(): Promise<unknown> } = {},
	) =>
		wireSync({
			db: sandbox.db,
			documents: synced,
			folders,
			archive,
			locks: options.locks ?? locks,
			deviceId: sandbox.deviceId,
			older,
			listener: { reconciled: (change) => learnings.reconciled(change) },
			...(options.inStep ? { hosts: { inStep: options.inStep } } : {}),
		});
	const sync = newSync();
	const { documents, status } = sync;
	/** Each time the open screens heard that what waits changed: the Space and the project. */
	const told: [string, string][] = [];
	const learnings = wireLearnings({
		access: { openSpace: async () => {} },
		folders,
		documents,
		archive,
		status,
		holds: sync.reconciler,
		notifications: {
			learningsChanged: async (spaceId, projectId) => {
				told.push([spaceId, projectId]);
			},
		},
	});
	/** One more reconciler over this Device's folder and documents. */
	const newReconciler = (
		options: { locks?: typeof locks; inStep?(): Promise<unknown> } = {},
	) => newSync(options).reconciler;
	const { reconciler } = sync;
	const { reader } = wireFiles({
		dataDir: sandbox.dataDir,
		deviceId: sandbox.deviceId,
		pageWaitMs: options.pageWaitMs ?? 5_000,
		documents,
		status,
		archive,
		notes: learnings,
		sync: reconciler,
		markdown: { isMarkdown, headings: markdownHeadings },
	});
	const dir = folders.folder("p1");
	const document = () => documents.open("p1");
	return {
		sandbox,
		folders,
		documents,
		synced,
		locks,
		newReconciler,
		reconciler,
		reader,
		learnings,
		told,
		dir,
		document,
		entries: async () => (await document()).entries(),
		put: async (path: string, text: string | Uint8Array, at?: number) => {
			const file = join(dir, path);
			await mkdir(dirname(file), { recursive: true });
			await writeFile(file, text);
			if (at !== undefined) await utimes(file, at / 1000, at / 1000);
		},
		read: (path: string) => readFile(join(dir, path), "utf8"),
		has: (path: string) =>
			stat(join(dir, path)).then(
				() => true,
				() => false,
			),
	};
}
type KnowledgeDevice = Awaited<ReturnType<typeof knowledgeDevice>>;

/** The documents of the Devices in step, as their Links leave them. */
export async function syncKnowledgeDocuments(...devices: KnowledgeDevice[]) {
	const docs = await Promise.all(
		devices.map(
			async (d) => (await d.synced.open(documentName("knowledge", "p1"))).doc,
		),
	);
	for (const from of docs) {
		const update = Y.encodeStateAsUpdate(from);
		for (const to of docs) if (to !== from) Y.applyUpdate(to, update);
	}
}
