import { mkdir, readFile, stat, utimes, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { project } from "@nightshift/db/schema";
import * as Y from "yjs";
import { type ArchiveHost, createSpaceArchive } from "../archive";
import { createSyncedDocuments, documentName } from "../documents";
import { createKnowledgeFolders } from "../knowledge/folder";
import { createKnowledgeFolderLocks } from "../knowledge/folder-locks";
import { createKnowledgeDocuments } from "../knowledge/knowledge-document";
import { createKnowledgeReader } from "../knowledge/knowledge-reader";
import { createLearnings } from "../knowledge/learnings";
import { createKnowledgeReconciler } from "../knowledge/reconcile";
import { createSpaceHostStatus } from "../knowledge/space-host-status";
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
	const folders = createKnowledgeFolders(sandbox.dataDir);
	const synced = createSyncedDocuments({ db: sandbox.db });
	const documents = createKnowledgeDocuments({
		db: sandbox.db,
		documents: synced,
	});
	const archive = createSpaceArchive(sandbox.dataDir);
	if (host) archive.connect(host);
	const status = createSpaceHostStatus(sandbox.db);
	const locks = createKnowledgeFolderLocks();
	/** Each time the open screens heard that what waits changed: the Space and the project. */
	const told: [string, string][] = [];
	const learnings = createLearnings({
		folders,
		documents,
		archive,
		status,
		startStep: (projectId) => reconciler.startStep(projectId),
		notifications: {
			learningsChanged: async (spaceId, projectId) => {
				told.push([spaceId, projectId]);
			},
		},
	});
	/** One more instance over this Device's folder and documents. */
	const newReconciler = (
		options: { locks?: typeof locks; inStep?(): Promise<unknown> } = {},
	) =>
		createKnowledgeReconciler({
			folders,
			documents,
			archive,
			status,
			locks: options.locks ?? locks,
			deviceId: sandbox.deviceId,
			reconciled: learnings.reconciled,
			...(options.inStep ? { inStep: options.inStep } : {}),
		});
	const reconciler = newReconciler();
	const reader = createKnowledgeReader({
		folders,
		documents,
		archive,
		learnings,
		status,
		deviceId: sandbox.deviceId,
		reconcileUnlessHeld: reconciler.reconcileUnlessHeld,
		pageWaitMs: options.pageWaitMs ?? 5_000,
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
