import type {
	IndexedFile,
	IndexedFileWrite,
	SectionToEmbed,
	WordSection,
} from "../../../search-index";
import type { KnowledgeMeaning } from "../domain/meaning";
import type { SectionPage, SplitSection } from "../domain/sections";

/**
 * The driven ports of knowledge/search. A port of its own has a real adapter,
 * an in-memory adapter and a contract suite in `adapters/out/`. Another
 * slice or package fills a port with `@filledBy`: the composition of the
 * package passes it to `wireSearch`.
 */

/** The text of the files the index reads: the start of a text file, the pages of a PDF or Word file. */
export type FileTexts = {
	/** Whether the file is a PDF or Word file, by its name. */
	isDocument(path: string): boolean;
	/** The first `maxBytes` of a file of the folder `dir` as text. Null when it is no file. */
	start(dir: string, path: string, maxBytes: number): Promise<string | null>;
	/** The pages of a PDF or Word file of the folder `dir`. Null when its text cannot be read. */
	pages(dir: string, path: string): Promise<SectionPage[] | null>;
};

/** Cuts a file into the sections a search finds. */
export type SectionSplitter = {
	/**
	 * The sections of a file, in order: of its text, or of the pages a
	 * document loader gave, each section on one page. A file with no text
	 * gets one empty section, so its path and title still find it.
	 */
	split(
		path: string,
		content: string | readonly SectionPage[],
	): Promise<SplitSection[]>;
};

/** Keeps the vectors of a project in step with its sections. */
export type VectorIndexing = {
	/**
	 * Embeds the sections that have no vector of `model` yet, and drops the
	 * vectors of the sections that are not in `sections` any more. A section
	 * that did not change costs no embedding.
	 */
	index(
		projectId: string,
		model: Pick<KnowledgeMeaning, "model" | "embeddings">,
		sections: readonly SectionToEmbed[],
	): Promise<void>;
};

/**
 * The embedding model for search by meaning now. The owner of the computer
 * can pick another model, or another Ollama, while Night Shift runs.
 * @filledBy engine/ollama
 */
export type MeaningModel = {
	/** The model now. Null: search by meaning is off. */
	current(): KnowledgeMeaning | null;
};

/** A section's vector as a search finds it. */
type VectorHit = { pageContent: string; metadata: Record<string, unknown> };

/**
 * The search index on this computer: the files of the projects' knowledge,
 * their sections, words and vectors, in a file that can be built again.
 * @filledBy engine/search-index
 */
export type SearchIndex = {
	/** The index, opened once. A file that does not open is built again. */
	open(): Promise<void>;
	isOpen(): boolean;
	/** Which opening of the index this is: another number means the file closed in between. */
	opening(): number;
	/** Closes the index file. A later `open` opens it again. */
	close(): void;
	/** `work`, and once more on a new index when the file is broken. */
	healing<T>(work: () => Promise<T>): Promise<T>;
	/** The files the index has of the project, by path. */
	files(projectId: string): Map<string, IndexedFile>;
	/** Drops files and their sections. */
	removeFiles(rows: readonly IndexedFile[]): void;
	/** Writes what a refresh read. True when the sections of a file changed. */
	writeFiles(projectId: string, batch: readonly IndexedFileWrite[]): boolean;
	/** The sections whose words match, best first, at most `limit`. With `folders`: in those only. */
	sectionsWithWords(
		projectId: string,
		match: string,
		limit: number,
		folders?: readonly string[],
	): WordSection[];
	/** The file at `path`. Null: it went. */
	fileAt(projectId: string, path: string): { id: number; title: string } | null;
	/** The first section of the file with this id. Null: the file has none. */
	section(
		fileId: number,
		id: string,
	): {
		heading: string | null;
		line: number;
		page: number | null;
		text: string;
	} | null;
	/** The sections that get a vector: the ones with text. */
	sectionsToEmbed(projectId: string): SectionToEmbed[];
	/** How many sections get a vector. */
	sectionCount(projectId: string): number;
	/** The text of the sections, for the Map, up to the limits. */
	sectionTexts(
		projectId: string,
		limits: { maxBytes: number; maxBytesPerFile: number },
	): { read: { path: string; sections: string[] }[]; filesLeftOut: number };
	/** What changes when the Map's reads would read something else. */
	mapStamp(projectId: string): string;
	/** The vectors of this model that still belong to a section, at most `limit`. */
	storedVectors(
		projectId: string,
		model: string,
		limit: number,
	): { path: string; vector: Float32Array }[];
	/** The vectors of the project's notes, by the hash of their text. */
	noteVectors(projectId: string, model: string): Map<string, Float32Array>;
	/** Which notes of the project have a vector of this model. */
	noteHashes(projectId: string, model: string): Set<string>;
	/** Stores vectors of the project's notes. The vectors of another model go first. */
	writeNoteVectors(
		projectId: string,
		model: string,
		rows: readonly { hash: string; vector: readonly number[] }[],
	): void;
	/** Drops the vectors of the project's notes that are not these. */
	keepNoteVectors(projectId: string, hashes: readonly string[]): void;
	/** The project's vectors of this model. The vectors of another model go first. */
	vectorsFor(
		projectId: string,
		model: Pick<KnowledgeMeaning, "model" | "embeddings">,
	): {
		/** How many sections of the project have a vector. */
		count(): number;
		/** The `k` vectors closest to `query`, closest first, each with its cosine. */
		similaritySearchVectorWithScore(
			query: number[],
			k: number,
			filter?: (hit: VectorHit) => boolean,
		): Promise<[VectorHit, number][]>;
	};
	/** The model the vectors belong to now. Null: closed, or no model asked yet. */
	vectorModel(): string | null;
	/** Drops every vector: a model embedded while this one took over. */
	resetVectors(model: string): void;
};
