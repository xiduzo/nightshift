import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { Refusal } from "@nightshift/refusal";
import { HostUnreachableError } from "../contract";
import { type CopyStamp, stampHolds } from "../log";
import { writeWhole } from "./write-whole";

/**
 * The Space archive: what a Replica keeps of a Space for the other
 * Replicas, and what it copied from them. On a Space's Host it is the
 * archive that each Device copies to. On a Device it is a cache of what
 * it fetched, and of its own knowledge content. One per Replica, over one
 * folder. Two kinds of file, one layout:
 *
 * - The walk files of runs walked elsewhere: a step's transcript and
 *   command log, and the run's latest Checkpoint. A Walker copies them to
 *   the Host when a node ends. A step's file has a stamp beside it: which
 *   end of the step it holds (`CopyStamp`). The engine writes and reads
 *   their content. The archive only keeps and carries it.
 * - Knowledge content by its hash (ADR 4). It never changes after it is
 *   written: a second write of a hash does nothing.
 *
 * Layout, the same on a Host and as a Device's cache:
 * `<data dir>/archive/<space>/<run>/<step>.ndjson`, `<step>.log`,
 * `<step>.<ext>.stamp` and `checkpoint.json`, and
 * `<data dir>/archive/<space>/knowledge/<sha256>`. Retention is
 * undecided, as it is for run history: everything is kept.
 *
 * The callers decide when to copy: the run actions after a node, the
 * knowledge reconcile after a publish. The archive decides where a file
 * goes (`put`) and where it comes from (`read`).
 */

/** A file of a run's walk state, by its Space and run (and step). */
export type WalkRef =
	| { kind: "checkpoint"; spaceId: string; runId: string }
	| {
			kind: "transcript" | "log";
			spaceId: string;
			runId: string;
			stepId: string;
	  };

/**
 * One file of a run's walk state. Its content is the engine's: the peers
 * keep and carry it. A step's file has the stamp of the end it holds.
 */
export type WalkFile = { ref: WalkRef; content: string; stamp?: CopyStamp };

/** Knowledge content by its hash, in a Space (ADR 4). */
export type ContentRef = { kind: "content"; spaceId: string; sha256: string };
export type ContentFile = { ref: ContentRef; content: Uint8Array };

/** One file of the archive. */
export type ArchiveRef = WalkRef | ContentRef;
/** One file of the archive with its content: text for a walk file, bytes for knowledge content. */
export type ArchiveEntry = WalkFile | ContentFile;

/** The Host that keeps a Space, as the archive copies files to it and fetches them. */
export type ArchiveHost = {
	/**
	 * Keeps a file in the archive of the Host that keeps its Space. False
	 * for a Space this Replica keeps: nothing went. Throws
	 * `HostUnreachableError` when that Host cannot be reached, and the
	 * Host's refusal.
	 */
	archivePut(entry: ArchiveEntry): Promise<boolean>;
	/**
	 * A file from the archive of the Host that keeps its Space: the Host
	 * checks a step's file against its own log. Null for a Space this
	 * Replica keeps, and when that Host has none. Throws when that Host
	 * cannot be reached.
	 */
	archiveGet(ref: ArchiveRef): Promise<string | Uint8Array | null>;
};

/** A Replica's Space archive. */
export type SpaceArchive = ReturnType<typeof createSpaceArchive>;

/** Ids that become path segments: no separators, no dots. */
const SEGMENT = /^[\w-]{1,128}$/;
const SHA256 = /^[0-9a-f]{64}$/;

/** The hash of content, as the knowledge document and the archive name it. */
export function sha256Of(content: Uint8Array): string {
	return createHash("sha256").update(content).digest("hex");
}

/** The hash of a file, read in parts: a large file never loads whole. */
export async function sha256OfFile(path: string): Promise<string> {
	const hash = createHash("sha256");
	for await (const chunk of createReadStream(path)) hash.update(chunk);
	return hash.digest("hex");
}

/** Where a file of the archive is. Refuses an id that is not one segment. */
function pathOf(dataDir: string, ref: ArchiveRef): string {
	const segments =
		ref.kind === "content"
			? [ref.spaceId]
			: ref.kind === "checkpoint"
				? [ref.spaceId, ref.runId]
				: [ref.spaceId, ref.runId, ref.stepId];
	for (const segment of segments) {
		if (!SEGMENT.test(segment)) throw new Error(`"${segment}" is not an id.`);
	}
	const space = join(dataDir, "archive", ref.spaceId);
	if (ref.kind === "content") {
		if (!SHA256.test(ref.sha256)) {
			throw new Error(`"${ref.sha256}" is not a hash.`);
		}
		return join(space, "knowledge", ref.sha256);
	}
	if (ref.kind === "checkpoint") {
		return join(space, ref.runId, "checkpoint.json");
	}
	const extension = ref.kind === "log" ? "log" : "ndjson";
	return join(space, ref.runId, `${ref.stepId}.${extension}`);
}

/** Where a step's file keeps its stamp: beside it. */
const stampOf = (path: string) => `${path}.stamp`;

/**
 * The changes of each file of the archive in this process, one at a time
 * in the order they came: a Host can get the same step twice at once (a
 * push, and the push again after the link came back), and a step's file
 * and its stamp must stay a pair. Per process, not per archive: a file has
 * one queue whoever writes it.
 */
const changing = new Map<string, Promise<void>>();

function oneAtATime(path: string, change: () => Promise<void>): Promise<void> {
	const next = (changing.get(path) ?? Promise.resolve()).then(change, change);
	changing.set(path, next);
	const forget = () => {
		if (changing.get(path) === next) changing.delete(path);
	};
	next.then(forget, forget);
	return next;
}

async function readOrNull(path: string): Promise<Buffer | null> {
	try {
		return await readFile(path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
}

/** A stamp as it was written, or null for one that is not valid: it holds nothing. */
function parseStamp(text: string): CopyStamp | null {
	try {
		const { opening, ended } = JSON.parse(text) as Partial<CopyStamp>;
		if (typeof opening === "number" && typeof ended === "boolean") {
			return { opening, ended };
		}
	} catch {
		// Not valid: below.
	}
	return null;
}

export function createSpaceArchive(dataDir: string) {
	/**
	 * The Hosts of the Spaces: the devices runtime, made after this. Until
	 * it connects, the archive does not know which Spaces a Host keeps: a
	 * read reads here only, and a put throws `HostUnreachableError`.
	 */
	let host: ArchiveHost | null = null;

	function readHere(ref: ContentRef): Promise<Uint8Array | null>;
	function readHere(
		ref: WalkRef,
		known: CopyStamp | null,
	): Promise<string | null>;
	function readHere(
		ref: ArchiveRef,
		known?: CopyStamp | null,
	): Promise<string | Uint8Array | null>;
	/**
	 * This Replica's copy of a file. A copy of a step's file only when its
	 * stamp holds the step as the reader knows it (`known`, `stampHolds`):
	 * a copy without a stamp (from a Walker of an older version) holds
	 * every end. A checkpoint has no stamp. Null when there is none.
	 */
	async function readHere(
		ref: ArchiveRef,
		known: CopyStamp | null = null,
	): Promise<string | Uint8Array | null> {
		const path = pathOf(dataDir, ref);
		if (ref.kind === "content") {
			const content = await readOrNull(path);
			return content && new Uint8Array(content);
		}
		if (ref.kind !== "checkpoint") {
			const text = await readOrNull(stampOf(path));
			const stamp = text === null ? undefined : parseStamp(text.toString());
			if (stamp === null || !stampHolds(stamp, known)) return null;
		}
		return (await readOrNull(path))?.toString("utf8") ?? null;
	}

	/**
	 * Keeps a file here, whole. Knowledge content that is here already
	 * stays, and content that does not have its hash is refused. A step's
	 * file goes with its stamp: the content before its stamp, and an old
	 * stamp before the content, so a reader that reads the stamp first
	 * never takes a copy of an earlier end for a later one. Without a stamp
	 * (from a Walker of an older version) the copy has none.
	 */
	async function writeHere(entry: ArchiveEntry): Promise<void> {
		const path = pathOf(dataDir, entry.ref);
		if (entry.ref.kind === "content") {
			const { content } = entry as ContentFile;
			if (sha256Of(content) !== entry.ref.sha256) {
				throw new Refusal(
					"invalid",
					"The content does not have the hash it names.",
				);
			}
			return oneAtATime(path, async () => {
				if (await stat(path).catch(() => null)) return;
				await writeWhole(path, content);
			});
		}
		const { ref, content, stamp } = entry as WalkFile;
		return oneAtATime(path, async () => {
			if (!stamp) await rm(stampOf(path), { force: true });
			await writeWhole(path, content);
			if (stamp && ref.kind !== "checkpoint") {
				await writeWhole(stampOf(path), JSON.stringify(stamp));
			}
		});
	}

	/** Removes a step's copy here: another Replica reopened the step. Nothing happens when there is none. */
	async function dropHere(ref: WalkRef): Promise<void> {
		const path = pathOf(dataDir, ref);
		return oneAtATime(path, async () => {
			await rm(path, { force: true });
			await rm(stampOf(path), { force: true });
		});
	}

	function read(ref: ContentRef): Promise<Uint8Array | null>;
	function read(ref: WalkRef, known: CopyStamp | null): Promise<string | null>;
	/**
	 * A file of a Space: this Replica's copy (`here.read`), else the copy of
	 * the Host that keeps the Space, kept here for the next read. Content
	 * from the Host must have its hash. A step's file from the Host is kept
	 * only when the reader knows the step ended (`known`): then it is
	 * whole. Null when neither has one. Throws when that Host cannot be
	 * reached.
	 */
	async function read(
		ref: ArchiveRef,
		known: CopyStamp | null = null,
	): Promise<string | Uint8Array | null> {
		const local = await readHere(ref, known);
		if (local !== null || !host) return local;
		const fetched = await host.archiveGet(ref);
		if (ref.kind === "content") {
			if (
				!(fetched instanceof Uint8Array) ||
				sha256Of(fetched) !== ref.sha256
			) {
				return null;
			}
			await writeHere({ ref, content: fetched });
			return fetched;
		}
		if (typeof fetched !== "string") return null;
		if (ref.kind !== "checkpoint" && known?.ended) {
			await writeHere({ ref, content: fetched, stamp: known });
		}
		return fetched;
	}

	return {
		/** This Replica's own copies, as a Host serves them and a cache keeps them. */
		here: { read: readHere, write: writeHere, drop: dropHere },
		read,
		/**
		 * Keeps a file in the archive of the Replica that keeps its Space:
		 * this one, or its Host. Knowledge content stays here too: a Device
		 * keeps its own content (ADR 4). Throws `HostUnreachableError` when
		 * that Host cannot be reached, and the Host's refusal: the caller
		 * puts it again later.
		 */
		async put(entry: ArchiveEntry): Promise<void> {
			const content = entry.ref.kind === "content";
			if (content) await writeHere(entry);
			if (!host) throw new HostUnreachableError();
			if (!(await host.archivePut(entry)) && !content) await writeHere(entry);
		},
		/** The Hosts of the Spaces, once the devices runtime is up: from now on files go to them and come from them. */
		connect(hosts: ArchiveHost): void {
			host = hosts;
		},
	};
}
