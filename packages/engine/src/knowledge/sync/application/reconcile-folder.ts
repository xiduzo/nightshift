import { isKnowledgePath } from "../../files";
import { contentHash, type KnowledgeEntry } from "../domain/entry";
import type { KnowledgeFolderLocks } from "../domain/folder-locks";
import {
	AT_ONCE,
	emptyPlan,
	type FolderFile,
	formatReconcileState,
	IN_STEP_AFTER_MS,
	IN_STEP_BEFORE_MS,
	inTurns,
	type Kept,
	parseReconcileState,
	pathsToSettle,
	type SettleTools,
	settle,
} from "../domain/merge";
import type { OlderHosts } from "../domain/older-hosts";
import type {
	ContentArchive,
	KnowledgeDocuments,
	ProjectSpaces,
	ReconcileListener,
	SpaceHosts,
	WorkingCopy,
} from "./ports";

export type ReconcileFolderPorts = {
	copy: WorkingCopy;
	documents: Pick<KnowledgeDocuments, "open">;
	archive: ContentArchive;
	spaces: Pick<ProjectSpaces, "spaceOf">;
	hosts: SpaceHosts;
	listener: ReconcileListener;
	/** Which Hosts run an older version of Night Shift: shared with the reader. */
	older: OlderHosts;
	now: () => number;
	/** The turns and the holds of each folder in this process. */
	locks: KnowledgeFolderLocks;
	/** The projects whose content waits for the Host. */
	pending: Set<string>;
	/** This Device: it signs the entries it writes. */
	deviceId: string;
	/** Past this many bytes a file stays on this Device (`LOCAL_ONLY_BYTES` of `file-loaders`). */
	localOnlyBytes: number;
};

/** Which project's folder to bring in step. */
export type ReconcileFolder = { projectId: string };

/**
 * Brings a project's folder and its knowledge document in step, after
 * every turn of the folder before it (`merge.ts` says how). One reconcile
 * of a folder at a time, in this process. Night Shift asks it: a step
 * before and after it, the page, the timers.
 *
 * The order of a pass: a short wait for the Host's changes, the content
 * that waits for the Host first, each path settled (8 at a time, sorted),
 * every removal from the folder before any write into it, the document,
 * the state, the hook, then a wait for the Host when this Device changed
 * the document.
 */
export const reconcileFolder =
	(ports: ReconcileFolderPorts) =>
	({ projectId }: ReconcileFolder): Promise<void> =>
		ports.locks.inTurn(ports.copy.folder(projectId), () =>
			reconcileOnce(ports, projectId),
		);

async function reconcileOnce(
	ports: ReconcileFolderPorts,
	projectId: string,
): Promise<void> {
	const { copy, archive, older, now, deviceId } = ports;
	const space = await ports.spaces.spaceOf(projectId);
	if (space === null) return;
	const spaceId: string = space;
	const document = await ports.documents.open(projectId);
	// A Host of an older version takes no knowledge: no wait, no call.
	const isOlder = older.isOlder(spaceId, now());
	// The Host's changes first, a short while: the step must not wait long.
	if (!isOlder) {
		await ports.hosts
			.inStep?.(spaceId, [document.name], { timeoutMs: IN_STEP_BEFORE_MS })
			.catch(() => {});
	}
	await copy.ensure(projectId);

	const state = parseReconcileState(await copy.readState(projectId));
	// A document that never had an update (a new Replica) is not one
	// whose entries were removed: the folder's files are published again.
	const saved = new Map<string, Kept>(
		state && !document.isNew() ? Object.entries(state.files) : [],
	);
	const unpushed = new Set(state?.unpushed ?? []);
	/** The Host failed once: the rest waits for the next reconcile. */
	let offline = isOlder;
	const ref = (sha256: string) => ({
		kind: "content" as const,
		spaceId,
		sha256,
	});

	/** Keeps content in the archive: here, and at the Host while it answers. */
	async function keep(sha256: string, content: Uint8Array) {
		if (!offline) {
			try {
				await archive.put({ ref: ref(sha256), content });
				unpushed.delete(sha256);
				older.answered(spaceId);
				return;
			} catch (error) {
				older.heard(spaceId, error, now());
				offline = true;
			}
		}
		await archive.here.write({ ref: ref(sha256), content });
		unpushed.add(sha256);
	}

	// First what earlier reconciles could not copy to the Host.
	for (const sha256 of [...unpushed]) {
		if (offline) break;
		const content = await archive.here.read(ref(sha256));
		if (content) await keep(sha256, content);
		else unpushed.delete(sha256);
	}

	/** Content by hash: here, else from the Host while it answers. */
	async function fetch(sha256: string): Promise<Uint8Array | null> {
		if (offline) return archive.here.read(ref(sha256));
		try {
			return await archive.read(ref(sha256));
		} catch (error) {
			older.heard(spaceId, error, now());
			offline = true;
			return null;
		}
	}

	const snapshot = await copy.scan(projectId);
	const local = snapshot.changedSince(saved);
	const entries = document.entries();
	/** What `settle` decides: the folder's part is done after every path is settled. */
	const plan = emptyPlan();

	/** Publishes the folder's file: content to the archive, then its entry. */
	async function publish(
		path: string,
		file: FolderFile,
		after: number,
	): Promise<Kept | null> {
		const changedAt = Math.max(file.changedAt, after + 1);
		let entry: KnowledgeEntry;
		if (file.size > ports.localOnlyBytes) {
			const sha256 = await snapshot.sha256(path);
			if (sha256 === null) return null;
			entry = { sha256, size: file.size, changedAt, deviceId, local: true };
		} else {
			const content = await copy.read(projectId, path);
			if (content === null) return null;
			const sha256 = contentHash(content);
			await keep(sha256, content);
			entry = { sha256, size: content.length, changedAt, deviceId };
		}
		plan.sets.push([path, entry]);
		return { ...entry, mtimeMs: file.changedAt };
	}

	/** Writes the entry's content into the folder. Null when it cannot now. */
	async function take(path: string, entry: KnowledgeEntry) {
		// A large file stays on the Device that has it.
		if (entry.local) return null;
		if (!(await copy.inFolder(projectId, path))) return null;
		const content = await fetch(entry.sha256);
		if (!content) return null;
		const written = await copy.write(projectId, path, content);
		if (!written) return null;
		return { ...entry, size: written.size, mtimeMs: written.mtimeMs };
	}

	const tools: SettleTools = {
		file: (path) => snapshot.file(path) ?? null,
		changedHere: (path) => local.changed.has(path),
		sha256: (path) => snapshot.sha256(path),
		publish,
		inFolder: (path) => copy.inFolder(projectId, path),
	};
	const paths = pathsToSettle(snapshot.files, saved, entries, isKnowledgePath);
	await inTurns(paths, AT_ONCE, (path) =>
		settle(
			path,
			{ was: saved.get(path) ?? null, entry: entries.get(path) ?? null },
			tools,
			plan,
		),
	);
	// Removals before writes, never side by side. A removal also removes
	// the folders it leaves empty, and a write at the same time may need
	// one of them: a moved file would wait for the next reconcile.
	await inTurns(plan.removals, AT_ONCE, (path) => copy.remove(projectId, path));
	await inTurns(plan.takes, AT_ONCE, async ([path, entry]) => {
		const taken = await take(path, entry);
		if (taken) plan.next.set(path, taken);
		else {
			const was = saved.get(path);
			if (was) plan.next.set(path, was);
		}
	});

	await document.apply({ delete: plan.deletes, set: plan.sets });
	await copy.writeState(
		projectId,
		formatReconcileState({
			files: Object.fromEntries(plan.next),
			unpushed: [...unpushed],
		}),
	);
	if (unpushed.size > 0) ports.pending.add(projectId);
	else ports.pending.delete(projectId);
	await ports.listener.reconciled?.({
		projectId,
		spaceId,
		held: state?.files ?? {},
		listed: document.entries(),
	});
	if (
		(plan.sets.length > 0 || plan.deletes.length > 0) &&
		!older.isOlder(spaceId, now())
	) {
		// This Device's changes reach the Host before the step ends: the
		// next step on another Device reads them.
		await ports.hosts
			.inStep?.(spaceId, [document.name], { timeoutMs: IN_STEP_AFTER_MS })
			.catch(() => {});
	}
}
