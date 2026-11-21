import type { FolderSnapshot } from "../../../folder-snapshot";
import type { DescribedSource } from "../domain/describe";
import type { WrittenIndex } from "../domain/index-text";
import type { ListedDocument } from "../domain/listing";
import type { KnowledgeFile } from "../domain/paths";
import type { KnowledgeText, ReadFrom } from "../domain/text";

/**
 * The driven ports of knowledge/files. A port of its own has a real adapter,
 * an in-memory adapter and a contract suite in `adapters/out/`. Another
 * slice or package fills a port with `@filledBy`: the composition of the
 * package passes it to `wireFiles`.
 */

/**
 * The knowledge folders of the projects on this computer:
 * `<dataDir>/knowledge/<projectId>/`, outside the repository and outside
 * every worktree. Each Device has a working copy of the Project's
 * knowledge there.
 */
export type KnowledgeFolders = {
	/** The project's folder. Throws for an id that is not one. */
	folder(projectId: string): string;
	/** The folder, made when it is not there yet. */
	ensure(projectId: string): Promise<string>;
	/** The projects that have a folder on this computer, by id. */
	known(): Promise<string[]>;
	/** The project's folder as it is now: the files that count, and those a person or an agent reads. */
	scan(projectId: string): Promise<FolderSnapshot>;
	/**
	 * One file of the folder, by its path, at most `maxBytes` of its text:
	 * a PDF or Word file's text, any other file's first bytes. Null when the
	 * folder has no such file, or the path is not one a person or an agent
	 * reads, or a link leads it out of the folder. Refuses a file that is
	 * not text and a document whose text it cannot read.
	 */
	read(
		projectId: string,
		path: string,
		maxBytes: number,
		from?: ReadFrom,
	): Promise<KnowledgeText | null>;
};

/** The index file (`INDEX.md`) of a folder, and the files it describes. */
export type FolderIndex = {
	/** The folder's index as it is: its time and its text. Null when it has none. */
	written(dir: string): Promise<WrittenIndex | null>;
	/** What gives the file's title and first sentence: only what they need is read. */
	source(dir: string, path: string): Promise<DescribedSource>;
	/** The first `bytes` of a file of the folder as text, and its size. Null when it is no file. */
	head(
		dir: string,
		path: string,
		bytes: number,
	): Promise<{ text: string; size: number } | null>;
	/** Writes the index whole. A folder that is not there is made. */
	write(dir: string, text: string): Promise<void>;
};

/**
 * The folders of the views a step gets: each a folder of its own, outside
 * the knowledge folder and outside every worktree.
 */
export type ViewCopies = {
	/** A new, empty folder for a view. */
	make(): Promise<string>;
	/**
	 * Copies a file of the folder `source` into the view `view`, with the
	 * time it last changed. False when the file went since the look.
	 */
	copy(source: string, view: string, file: KnowledgeFile): Promise<boolean>;
	/** The view as it is now. */
	scan(view: string): Promise<FolderSnapshot>;
	/** Removes the view. Twice is fine. */
	remove(view: string): Promise<void>;
};

/** The text of a file of the knowledge from its content: for a Device that has the file by its hash only. */
export type ContentTexts = {
	/**
	 * The file as a read of the folder gives it. Null for a path a person
	 * or an agent does not read.
	 */
	text(
		path: string,
		content: Uint8Array,
		maxBytes: number,
		from?: ReadFrom,
	): Promise<KnowledgeText | null>;
};

/** A wait of some time. */
export type Wait = {
	/** Resolves after `ms`. */
	wait(ms: number): Promise<void>;
};

/**
 * The knowledge documents of the Projects: what the Space lists.
 * @filledBy engine/knowledge
 */
export type KnowledgeEntries = {
	open(projectId: string): Promise<ListedDocument>;
};

/**
 * A Project's Space and its Host, as far as this Device knows them.
 * @filledBy engine/knowledge
 */
export type SpaceStatus = {
	/** The Space of a Project. Null for a Project this Replica does not have. */
	spaceOf(projectId: string): Promise<string | null>;
	/** Whether a Space has Members besides one Person. */
	isShared(spaceId: string): Promise<boolean>;
	/** Whether the Space's Host runs an older version of Night Shift. */
	isOlder(spaceId: string): boolean;
	/** What a failed knowledge call to the Host says about it. */
	heard(spaceId: string, error: unknown): void;
};

/**
 * The knowledge content by hash: here, else at the Space's Host.
 * @filledBy engine/archive
 */
export type ContentArchive = {
	read(ref: {
		kind: "content";
		spaceId: string;
		sha256: string;
	}): Promise<Uint8Array | null>;
};

/**
 * How many notes the proposed learnings of a project hold. It asks no Host.
 * @filledBy engine/knowledge
 */
export type WaitingNotes = {
	count(projectId: string): Promise<number>;
};

/**
 * The reconcile of a project's folder with the Space.
 * @filledBy engine/knowledge
 */
export type FolderSync = {
	/** A reconcile, unless a step writes the folder now. Never fails. */
	reconcileUnlessHeld(projectId: string): Promise<unknown>;
};
