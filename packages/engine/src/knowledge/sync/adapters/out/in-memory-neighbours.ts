import type {
	ContentArchive,
	MeasureNotes,
	ReconcileListener,
	SpaceHosts,
} from "../../application/ports";
import type { ContentRef } from "../../domain/entry";
import { createKnowledgeFolderLocks } from "../../domain/folder-locks";
import type { KnowledgeReconciled } from "../../domain/merge";
import { inMemoryKnowledgeDocuments } from "./in-memory-knowledge-documents";
import { inMemoryWorkingCopy } from "./in-memory-working-copy";

/**
 * The in-memory adapters of the ports that another slice or package
 * fills (`@filledBy` in `application/ports.ts`), and
 * `inMemorySyncPorts`, the ports of the slice that are no database. Test code: production code never imports this file.
 */

/**
 * The content by hash in memory: what is kept here, and what the Host
 * keeps. `down` makes every call to the Host throw `failWith`.
 */
export function inMemoryContentArchive() {
	const key = (ref: ContentRef) => `${ref.spaceId}/${ref.sha256}`;
	const here = new Map<string, { content: Uint8Array; keptAt: number }>();
	const host = new Map<string, Uint8Array>();
	const twin = {
		/** Every call to the Host, in order: `put <sha256>`, `get <sha256>`. */
		calls: [] as string[],
		down: false,
		failWith: new Error("The network connection was lost.") as unknown,
		/** The content the Host keeps. */
		host,
		/** Keeps content here, `keptAt` then. */
		keepHere(ref: ContentRef, content: Uint8Array, keptAt = 0) {
			here.set(key(ref), { content, keptAt });
		},
		hasHere: (ref: ContentRef) => here.has(key(ref)),
		here: {
			async read(ref: ContentRef) {
				return here.get(key(ref))?.content ?? null;
			},
			async write(file: { ref: ContentRef; content: Uint8Array }) {
				here.set(key(file.ref), { content: file.content, keptAt: 0 });
			},
			async drop(ref: ContentRef, options: { keptBefore: number }) {
				const kept = here.get(key(ref));
				if (!kept || kept.keptAt >= options.keptBefore) return false;
				here.delete(key(ref));
				return true;
			},
			async contents() {
				return [...here].map(([at, { keptAt }]) => {
					const [spaceId = "", sha256 = ""] = at.split("/");
					return { spaceId, sha256, keptAt };
				});
			},
		},
		async read(ref: ContentRef) {
			twin.calls.push(`get ${ref.sha256}`);
			const local = here.get(key(ref));
			if (local) return local.content;
			if (twin.down) throw twin.failWith;
			const content = host.get(key(ref)) ?? null;
			if (content) here.set(key(ref), { content, keptAt: 0 });
			return content;
		},
		async put(file: { ref: ContentRef; content: Uint8Array }) {
			twin.calls.push(`put ${file.ref.sha256}`);
			here.set(key(file.ref), { content: file.content, keptAt: 0 });
			if (twin.down) throw twin.failWith;
			host.set(key(file.ref), file.content);
		},
	};
	return twin satisfies ContentArchive;
}

/** The Hosts in memory: each wait for a Space's documents is kept, in order. */
export function inMemorySpaceHosts() {
	const twin = {
		waits: [] as { spaceId: string; timeoutMs: number }[],
		kept: new Set<string>(),
		async inStep(
			spaceId: string,
			_names: readonly string[],
			options: { timeoutMs: number },
		) {
			twin.waits.push({ spaceId, timeoutMs: options.timeoutMs });
		},
		async keeps(spaceId: string) {
			return twin.kept.has(spaceId);
		},
	};
	return twin satisfies Required<SpaceHosts>;
}

/** What hears of each reconcile, in memory. */
export function inMemoryReconcileListener() {
	const twin = {
		heard: [] as KnowledgeReconciled[],
		async reconciled(change: KnowledgeReconciled) {
			twin.heard.push(change);
		},
	};
	return twin satisfies ReconcileListener;
}

/** The usage notes in memory. */
export function inMemoryMeasureNotes() {
	const twin = {
		notes: [] as { projectId: string; bytes: number }[],
		note(moment: { projectId: string; bytes: number }) {
			twin.notes.push({ projectId: moment.projectId, bytes: moment.bytes });
		},
	};
	return twin satisfies MeasureNotes;
}

/** The ports of knowledge/sync that are no database, in memory. */
export function inMemorySyncPorts() {
	let clock = 1_000_000;
	return {
		copy: inMemoryWorkingCopy(),
		documents: inMemoryKnowledgeDocuments(),
		archive: inMemoryContentArchive(),
		hosts: inMemorySpaceHosts(),
		listener: inMemoryReconcileListener(),
		notes: inMemoryMeasureNotes(),
		now: () => clock,
		/** Sets the clock. */
		setNow(at: number) {
			clock = at;
		},
		locks: createKnowledgeFolderLocks(),
		pending: new Set<string>(),
		deviceId: "laptop",
		localOnlyBytes: 10 * 1024 * 1024,
	};
}
