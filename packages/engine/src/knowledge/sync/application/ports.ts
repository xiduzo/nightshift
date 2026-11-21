import type { FolderSnapshot } from "../../../folder-snapshot";
import type { ContentRef, KnowledgeDocument } from "../domain/entry";
import type { KnowledgeReconciled } from "../domain/merge";

/**
 * The driven ports of knowledge/sync. A port of its own has a real adapter,
 * an in-memory adapter and a contract suite in `adapters/out/`. Another
 * slice or package fills a port with `@filledBy`: the composition of the
 * package passes it to `wireSync`.
 */

/**
 * A project's knowledge folder on this computer, as the reconcile reads and
 * writes it: its files, by their paths in the knowledge, and the state of
 * the last reconcile (`.reconciled.json`, hidden in the folder).
 */
export type WorkingCopy = {
	/** The project's folder: also the key of its turns and holds (`KnowledgeFolderLocks`). */
	folder(projectId: string): string;
	/** The projects that have a folder on this computer, by id. */
	known(): Promise<string[]>;
	/** Makes the folder when it is not there yet. */
	ensure(projectId: string): Promise<void>;
	/** Whether the project has a folder on this computer. */
	exists(projectId: string): Promise<boolean>;
	/** The folder as it is now. */
	scan(projectId: string): Promise<FolderSnapshot>;
	/** A file's content. Null when it cannot be read. */
	read(projectId: string, path: string): Promise<Uint8Array | null>;
	/** Writes a file whole, and gives its size and time after. Null when it cannot. */
	write(
		projectId: string,
		path: string,
		content: Uint8Array,
	): Promise<{ size: number; mtimeMs: number } | null>;
	/**
	 * Whether the folders of a path are real folders inside the knowledge
	 * folder: a link among them could lead a write or a removal out of it.
	 */
	inFolder(projectId: string, path: string): Promise<boolean>;
	/** Removes a file and the folders it leaves empty, up to the knowledge folder. */
	remove(projectId: string, path: string): Promise<void>;
	/** The text of the state of the last reconcile. Null when the folder has none. */
	readState(projectId: string): Promise<string | null>;
	/** Writes the state of this reconcile whole. */
	writeState(projectId: string, text: string): Promise<void>;
	/**
	 * Moves the folder of `from` to the place of the folder of `to`. When
	 * that place has a folder already, each file goes into it, unless the
	 * file there is newer. The old folder goes.
	 */
	move(from: string, to: string): Promise<void>;
};

/** The knowledge documents of this Replica's Projects: views of its synced documents. */
export type KnowledgeDocuments = {
	/** The Project's knowledge document. */
	open(projectId: string): Promise<KnowledgeDocument>;
	/** Closes the Project's knowledge document and deletes it from this Replica: its Project moved to another id. */
	remove(projectId: string): Promise<void>;
	/**
	 * The size of each knowledge document this Replica keeps, in bytes. Yjs
	 * keeps a deleted entry for ever (`docs/knowledge.md`, "How the knowledge
	 * document grows"), so this is its growth. It loads no document.
	 */
	sizes(): Promise<{ projectId: string; bytes: number }[]>;
};

/** Which Space a Project has, and what the Space is. */
export type ProjectSpaces = {
	/** The Space of a Project. Null for a Project this Replica does not have. */
	spaceOf(projectId: string): Promise<string | null>;
	/** Whether a Space has Members besides one Person: it is not a personal Space. */
	isShared(spaceId: string): Promise<boolean>;
	/** The Projects of a Space, a removed one too. */
	projectsIn(spaceId: string): Promise<string[]>;
};

/**
 * The knowledge content by hash: here, and at the Space's Host.
 * @filledBy engine/archive
 */
export type ContentArchive = {
	here: {
		read(ref: ContentRef): Promise<Uint8Array | null>;
		write(file: { ref: ContentRef; content: Uint8Array }): Promise<void>;
		/** Removes content last kept before `keptBefore`. True when it removed it. */
		drop(ref: ContentRef, options: { keptBefore: number }): Promise<boolean>;
		/** The content kept here, with when it was last kept. */
		contents(): Promise<{ spaceId: string; sha256: string; keptAt: number }[]>;
	};
	/** Content by hash: here, else from the Host. Throws when the Host cannot be asked. */
	read(ref: ContentRef): Promise<Uint8Array | null>;
	/** Keeps content here and at the Host. Throws when the Host cannot take it now. */
	put(file: { ref: ContentRef; content: Uint8Array }): Promise<void>;
};

/**
 * The Hosts of the Spaces, once the devices runtime is up.
 * @filledBy devices
 */
export type SpaceHosts = {
	/**
	 * Waits until this Replica's copies of documents of a Space and its
	 * Host's are in step, for `timeoutMs` at most. At once for a Space this
	 * Replica keeps, and while its Host cannot be reached. Without it: no wait.
	 */
	inStep?(
		spaceId: string,
		names: readonly string[],
		options: { timeoutMs: number },
	): Promise<unknown>;
	/**
	 * Whether this Replica keeps the Space: it is the Space's Host, or the
	 * Space has none. Without it, nothing is collected.
	 */
	keeps?(spaceId: string): Promise<boolean>;
};

/**
 * What depends on the document hears of each reconcile: the learnings.
 * @filledBy engine/knowledge
 */
export type ReconcileListener = {
	/** A reconcile brought the folder and the document in step. It must not fail. */
	reconciled?(change: KnowledgeReconciled): Promise<void>;
};

/**
 * Where the size of each knowledge document goes, for the anonymous usage.
 * @filledBy engine/usage
 */
export type MeasureNotes = {
	note(moment: {
		kind: "knowledge-document-measured";
		projectId: string;
		bytes: number;
	}): void;
};
