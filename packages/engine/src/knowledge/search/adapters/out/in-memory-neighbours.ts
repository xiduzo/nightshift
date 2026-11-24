import { inMemoryKnowledgeFolders } from "../../../files/adapters/out/in-memory-knowledge-folders";
import type { MeaningModel, SearchIndex } from "../../application/ports";
import type { KnowledgeMeaning } from "../../domain/meaning";
import { inMemoryFileTexts } from "./in-memory-file-texts";
import { inMemorySectionSplitter } from "./in-memory-section-splitter";
import { inMemoryVectorIndexing } from "./in-memory-vector-indexing";

/**
 * The in-memory adapters of the ports that another slice or package
 * fills (`@filledBy` in `application/ports.ts`), and
 * `inMemorySearchPorts`, which gives a use-case test every port of
 * the slice at once. Test code: production code never imports this file.
 */

/** The embedding model of a test: none until the test sets one. */
export function inMemoryMeaningModel(meaning: KnowledgeMeaning | null = null) {
	let now = meaning;
	const twin = {
		/** The model from now on. Null: search by meaning is off. */
		set(next: KnowledgeMeaning | null) {
			now = next;
		},
		current: () => now,
	};
	return twin satisfies MeaningModel;
}

/** A section as the twin index keeps it. */
type TwinSection = {
	id: string;
	heading: string | null;
	headingPath: string;
	line: number;
	page: number | null;
	text: string;
};

type TwinFile = {
	id: number;
	projectId: string;
	path: string;
	size: number;
	mtimeMs: number;
	sha256: string;
	title: string;
	sections: TwinSection[];
};

type TwinHit = { pageContent: string; metadata: Record<string, unknown> };

/**
 * The search index of a test. Words match when the text, the title, the
 * heading or the path holds them, in the order written. A test sets the
 * vectors a search finds (`setNearest`) and the Map's vectors (`setStored`).
 */
export function inMemorySearchIndex() {
	const files = new Map<number, TwinFile>();
	const nearest = new Map<string, [TwinHit, number][]>();
	const notes = new Map<string, Map<string, Float32Array>>();
	let stored: { path: string; vector: Float32Array }[] = [];
	let nextId = 1;
	let opened = false;
	let openings = 0;
	let model: string | null = null;
	const ofProject = (projectId: string) =>
		[...files.values()]
			.filter((f) => f.projectId === projectId)
			.sort((a, b) => a.path.localeCompare(b.path));
	const align = (next: string) => {
		if (model !== null && model !== next) {
			nearest.clear();
			notes.clear();
		}
		model = next;
	};
	/** The word queries asked, in order. */
	const matches: string[] = [];
	const sectionsToEmbed = (projectId: string) =>
		ofProject(projectId).flatMap((f) =>
			f.sections
				.filter((s) => s.text !== "")
				.map((s) => ({
					path: f.path,
					title: f.title,
					heading_path: s.headingPath,
					text: s.text,
					section_id: s.id,
				})),
		);
	const writeFiles: SearchIndex["writeFiles"] = (projectId, batch) => {
		let moved = false;
		for (const item of batch) {
			const { path, size, changedAt } = item.file;
			if (item.same) {
				const kept = files.get(item.row.id);
				if (kept) Object.assign(kept, { size, mtimeMs: changedAt });
				continue;
			}
			moved = true;
			const id = item.row?.id ?? nextId++;
			files.set(id, {
				id,
				projectId,
				path,
				size,
				mtimeMs: changedAt,
				sha256: item.sha256,
				title: item.title,
				sections: [...item.sections],
			});
		}
		return moved;
	};
	const twin = {
		matches,
		/** Puts a file and its sections in the index, as a refresh writes them. */
		seed(
			projectId: string,
			file: { path: string; title: string; texts: string[]; sha256?: string },
		) {
			const row = ofProject(projectId).find((f) => f.path === file.path);
			writeFiles(projectId, [
				{
					file: { path: file.path, size: 1, changedAt: 1 },
					row: row && { ...row },
					same: false,
					sha256: file.sha256 ?? `sha-${file.path}`,
					title: file.title,
					sections: file.texts.map((text, at) => ({
						id: `${file.path}#${at}`,
						heading: null,
						headingPath: "",
						line: at + 1,
						page: null,
						text,
					})),
				},
			]);
		},
		/** The vectors a search by meaning finds in the project, closest first. */
		setNearest(projectId: string, hits: [TwinHit, number][]) {
			nearest.set(projectId, hits);
		},
		/** The vectors the Map reads. */
		setStored(vectors: { path: string; vector: Float32Array }[]) {
			stored = vectors;
		},
		async open() {
			if (opened) return;
			opened = true;
			openings += 1;
		},
		isOpen: () => opened,
		opening: () => openings,
		close() {
			opened = false;
		},
		healing: <T>(work: () => Promise<T>) => work(),
		files(projectId: string) {
			return new Map(
				ofProject(projectId).map(({ id, path, size, mtimeMs, sha256 }) => [
					path,
					{ id, path, size, mtimeMs, sha256 },
				]),
			);
		},
		removeFiles(rows) {
			for (const row of rows) files.delete(row.id);
		},
		writeFiles,
		sectionsWithWords(projectId, match, limit, folders) {
			matches.push(match);
			const terms = [...match.matchAll(/"([^"]*)"/g)].map((m) =>
				(m[1] ?? "").toLowerCase(),
			);
			const any = match.includes(" OR ");
			const within = (path: string) =>
				!folders || folders.some((f) => path === f || path.startsWith(`${f}/`));
			return ofProject(projectId)
				.filter((f) => within(f.path))
				.flatMap((f) =>
					f.sections
						.filter((s) => {
							const hay =
								`${f.path} ${f.title} ${s.heading ?? ""} ${s.text}`.toLowerCase();
							const has = (term: string) => hay.includes(term);
							return any ? terms.some(has) : terms.every(has);
						})
						.map((s) => ({
							path: f.path,
							title: f.title,
							heading: s.heading,
							line: s.line,
							page: s.page,
							snippet: s.text,
						})),
				)
				.slice(0, limit);
		},
		fileAt(projectId, path) {
			const f = ofProject(projectId).find((file) => file.path === path);
			return f ? { id: f.id, title: f.title } : null;
		},
		section(fileId, id) {
			const s = files.get(fileId)?.sections.find((one) => one.id === id);
			return s
				? { heading: s.heading, line: s.line, page: s.page, text: s.text }
				: null;
		},
		sectionsToEmbed,
		sectionCount: (projectId) => sectionsToEmbed(projectId).length,
		sectionTexts(projectId) {
			return {
				read: ofProject(projectId).map((f) => ({
					path: f.path,
					sections: f.sections.map((s) => s.text).filter((t) => t !== ""),
				})),
				filesLeftOut: 0,
			};
		},
		mapStamp: (projectId) =>
			JSON.stringify([
				ofProject(projectId).map((f) => [f.path, f.sha256]),
				nearest.get(projectId)?.length ?? 0,
				model,
			]),
		storedVectors: (_projectId, of, limit) =>
			of === model ? stored.slice(0, limit) : [],
		noteVectors: (projectId, of) =>
			of === model ? new Map(notes.get(projectId)) : new Map(),
		noteHashes: (projectId, of) =>
			of === model ? new Set(notes.get(projectId)?.keys()) : new Set(),
		writeNoteVectors(projectId, of, rows) {
			align(of);
			const kept = notes.get(projectId) ?? new Map();
			for (const { hash, vector } of rows) {
				kept.set(hash, new Float32Array(vector));
			}
			notes.set(projectId, kept);
		},
		keepNoteVectors(projectId, hashes) {
			const kept = notes.get(projectId);
			for (const hash of kept?.keys() ?? []) {
				if (!hashes.includes(hash)) kept?.delete(hash);
			}
		},
		vectorsFor(projectId, of) {
			align(of.model);
			return {
				count: () => nearest.get(projectId)?.length ?? 0,
				similaritySearchVectorWithScore: async (_query, k, filter) =>
					(nearest.get(projectId) ?? [])
						.filter(([hit]) => !filter || filter(hit))
						.slice(0, k),
			};
		},
		vectorModel: () => model,
		resetVectors(of) {
			nearest.clear();
			notes.clear();
			model = of;
		},
	} satisfies SearchIndex & Record<string, unknown>;
	return twin;
}

/** An embedding model of a test: every text is the same vector, and it is ready. */
export function fakeMeaning(
	overrides: Partial<KnowledgeMeaning> = {},
): KnowledgeMeaning {
	return {
		model: "fake-model",
		embeddings: {
			embedDocuments: async (texts) => texts.map(() => [1, 0]),
			embedQuery: async () => [1, 0],
		},
		query: (text) => text,
		ready: async () => "ready",
		...overrides,
	};
}

/** Every port of knowledge/search in memory at once: where each use-case test starts. */
export function inMemorySearchPorts() {
	return {
		index: inMemorySearchIndex(),
		folders: inMemoryKnowledgeFolders(),
		meaning: inMemoryMeaningModel(),
		fileTexts: inMemoryFileTexts(),
		sectionSplitter: inMemorySectionSplitter(),
		vectorIndexing: inMemoryVectorIndexing(),
	};
}
