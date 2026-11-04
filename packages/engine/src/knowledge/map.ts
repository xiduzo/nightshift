import type { WaitingLearning } from "./learnings";
import { findTopics, type TextOfFile } from "./topics";
import type { AskedQuestion } from "./use";

/**
 * The Map on the Knowledge page: the files, the topics they share, the links
 * between them, the files close in meaning, the questions that found them and
 * the learnings that name their topics.
 *
 * It draws what the search index already holds. It reads no file, it calls
 * no model and it never asks the Host, so a person can always open it. No
 * model made this: a Map a model makes would be a flow that writes a file
 * (`docs/research/knowledge-graph-extraction.md`).
 *
 * The product says Map, and so does this code. Only the wire keeps the older
 * name: `knowledge.graph` stays, because a client out there may call it.
 */

/** The node of a learning that waits. */
export function learningNode(id: string): string {
	return `learning:${id}`;
}

/** The node of a question agents asked. */
export function questionNode(query: string): string {
	return `question:${query}`;
}

export type KnowledgeMapNode = {
	/** `file:<path>`, `topic:<key>`, `question:<query>` or `learning:<id>`. */
	id: string;
	kind: "file" | "topic" | "question" | "learning";
	label: string;
	/** A file's path. Else null. */
	path: string | null;
	/** How many edges meet here. */
	degree: number;
};

export type KnowledgeMapEdge = {
	id: string;
	source: string;
	target: string;
	/**
	 * `mentions`: a file names a topic. `links`: a file links to a file.
	 * `found`: a question found a file. `touches`: a learning names a topic.
	 * `close`: two files are close in meaning, and neither links to the other.
	 */
	kind: "mentions" | "links" | "found" | "touches" | "close";
};

export type KnowledgeMap = {
	nodes: KnowledgeMapNode[];
	edges: KnowledgeMapEdge[];
	/** Files the Map did not read, because the knowledge is so large. */
	filesLeftOut: number;
	/** What people marked as not a topic, as they saw it. */
	notTopics: string[];
};

/** A section's vector, with its file. */
export type FileVector = { path: string; vector: Float32Array };

/** A file's sections as the index holds them, in order. */
export type SectionsOfFile = { path: string; sections: string[] };

/** A learning's words on the Map, at most. */
const LABEL_LENGTH = 60;
/**
 * How many closest files each file considers. Two files connect only when each
 * has the other among its closest. On this repository's docs that kept 38 of
 * the 382 pairs over the line, and the Map stays readable (`docs/knowledge.md`,
 * "The Map").
 */
const CLOSEST_FILES = 3;
/**
 * How many files the Map compares, at most: each pair is an exact scan on the
 * daemon's one thread, so the cost grows with the square of this. The first
 * files by path get edges, and the others stand without them.
 */
export const MAX_CLOSE_FILES = 400;

/**
 * The text of a file from its sections. The splitter repeats the end of a
 * section at the start of the next. Together again they count each word once,
 * and a code fence that a cut split closes again.
 */
export function textOfSections({ path, sections }: SectionsOfFile): TextOfFile {
	let text = "";
	for (const section of sections) {
		text += text === "" ? section : `\n${withoutOverlap(text, section)}`;
	}
	return { path, text };
}

/** How far back the overlap of two sections can go, and the start to look for. */
const OVERLAP_SEARCH = 300;
const OVERLAP_START = 12;

function withoutOverlap(before: string, section: string): string {
	const tail = before.slice(-OVERLAP_SEARCH);
	const start = section.slice(0, OVERLAP_START);
	for (
		let at = tail.indexOf(start);
		at >= 0;
		at = tail.indexOf(start, at + 1)
	) {
		if (section.startsWith(tail.slice(at))) {
			return section.slice(tail.length - at);
		}
	}
	return section;
}

/** The files of the knowledge that a text links to, by path. */
function linksOf(
	text: string,
	byTail: ReadonlyMap<string, string>,
	self: string,
): string[] {
	const found = new Set<string>();
	for (const match of text.matchAll(/\]\(([^)#\s]+)|\[\[([^\]|#]+)/g)) {
		const target = (match[1] ?? match[2] ?? "").replace(/^(?:\.{0,2}\/)+/, "");
		if (target === "" || target.startsWith("http")) continue;
		const path = byTail.get(target);
		if (path && path !== self) found.add(path);
	}
	return [...found];
}

/** Each path by what a link may call it: the whole path or its last parts, with or without `.md`. The first path wins. */
function pathsByTail(paths: readonly string[]): Map<string, string> {
	const byTail = new Map<string, string>();
	const put = (tail: string, path: string) => {
		if (!byTail.has(tail)) byTail.set(tail, path);
	};
	for (const path of paths) {
		const parts = path.split("/");
		for (let from = 0; from < parts.length; from++) {
			const tail = parts.slice(from).join("/");
			put(tail, path);
			if (tail.endsWith(".md")) put(tail.slice(0, -3), path);
		}
	}
	return byTail;
}

/** The middle of each file's sections, at length 1. */
function middlesOf(vectors: readonly FileVector[]): Map<string, Float32Array> {
	const middles = new Map<string, Float32Array>();
	for (const { path, vector } of vectors) {
		const known = middles.get(path);
		// A vector of another length is of another model: it is left out.
		if (known && known.length !== vector.length) continue;
		const middle = known ?? new Float32Array(vector.length);
		for (let d = 0; d < vector.length; d++) {
			middle[d] = (middle[d] as number) + (vector[d] as number);
		}
		middles.set(path, middle);
	}
	for (const middle of middles.values()) {
		let norm = 0;
		for (const x of middle) norm += x * x;
		norm = Math.sqrt(norm) || 1;
		for (let d = 0; d < middle.length; d++) {
			middle[d] = (middle[d] as number) / norm;
		}
	}
	return middles;
}

/**
 * The pairs of files close in meaning: the middle of their sections is at
 * `closeAt` or more, and each is among the other's closest. The middle says
 * what a file is about. The best pair of two sections says less, and favours
 * long files: on this repository's docs, 8 of its top 40 pairs shared a
 * subject by name, against 19 for the middle.
 */
export function closeFiles(
	vectors: readonly FileVector[],
	closeAt: number,
): [string, string][] {
	const middles = [...middlesOf(vectors)].slice(0, MAX_CLOSE_FILES);
	/** For each file, the closest other files over the line, closest first. */
	const near = middles.map(() => [] as { other: number; score: number }[]);
	for (let a = 0; a < middles.length; a++) {
		const left = middles[a]?.[1] as Float32Array;
		for (let b = a + 1; b < middles.length; b++) {
			const right = middles[b]?.[1] as Float32Array;
			if (left.length !== right.length) continue;
			let score = 0;
			for (let d = 0; d < left.length; d++) {
				score += (left[d] as number) * (right[d] as number);
			}
			if (score < closeAt) continue;
			near[a]?.push({ other: b, score });
			near[b]?.push({ other: a, score });
		}
	}
	const closest = near.map(
		(list) =>
			new Set(
				list
					.sort((x, y) => y.score - x.score)
					.slice(0, CLOSEST_FILES)
					.map(({ other }) => other),
			),
	);
	const pairs: [string, string][] = [];
	for (const [a, list] of closest.entries()) {
		for (const b of list) {
			if (a < b && closest[b]?.has(a)) {
				pairs.push([middles[a]?.[0] as string, middles[b]?.[0] as string]);
			}
		}
	}
	return pairs;
}

/** A file's name for a person, without its folder and extension. */
function fileLabel(path: string): string {
	return (path.split("/").pop() ?? path)
		.replace(/\.[a-z0-9]+$/i, "")
		.replace(/[-_]+/g, " ");
}

/** The Map of a project's knowledge, from what the index holds and what people did. */
export function knowledgeMapOf(input: {
	/** Every file, read or not. */
	files: readonly string[];
	/** The files read, with their sections. */
	read: readonly SectionsOfFile[];
	filesLeftOut: number;
	/** The sections' vectors. None: no edges of meaning. */
	vectors: readonly FileVector[];
	/** The line for files close in meaning. Null: this model has none measured. */
	closeAt: number | null;
	asked: readonly Pick<AskedQuestion, "query" | "hits">[];
	learnings: readonly Pick<WaitingLearning, "id" | "notes">[];
	/** What people marked, as they saw it. */
	notTopics: readonly string[];
}): KnowledgeMap {
	const nodes = new Map<string, KnowledgeMapNode>();
	const edges = new Map<string, KnowledgeMapEdge>();
	const connect = (
		source: string,
		target: string,
		kind: KnowledgeMapEdge["kind"],
	) => {
		const from = nodes.get(source);
		const to = nodes.get(target);
		const id = `${source}->${target}`;
		if (!from || !to || edges.has(id)) return;
		edges.set(id, { id, source, target, kind });
		from.degree += 1;
		to.degree += 1;
	};
	const addNode = (
		id: string,
		kind: KnowledgeMapNode["kind"],
		label: string,
		path: string | null = null,
	) => {
		if (!nodes.has(id)) nodes.set(id, { id, kind, label, path, degree: 0 });
	};

	const paths = [...new Set(input.files)].sort((a, b) => a.localeCompare(b));
	for (const path of paths) {
		addNode(`file:${path}`, "file", fileLabel(path), path);
	}
	const texts = input.read.map(textOfSections);
	const found = findTopics(
		texts,
		new Set(input.notTopics.map((word) => word.toLowerCase())),
	);
	for (const [key, label] of found.topics) {
		addNode(`topic:${key}`, "topic", label);
	}
	const byTail = pathsByTail(paths);
	for (const { path, text } of texts) {
		for (const key of found.ofFile.get(path) ?? []) {
			connect(`file:${path}`, `topic:${key}`, "mentions");
		}
		for (const target of linksOf(text, byTail, path)) {
			connect(`file:${path}`, `file:${target}`, "links");
		}
	}
	if (input.closeAt !== null) {
		for (const [a, b] of closeFiles(input.vectors, input.closeAt)) {
			// A link says it already, and says more.
			if (edges.has(`file:${b}->file:${a}`)) continue;
			connect(`file:${a}`, `file:${b}`, "close");
		}
	}
	for (const question of input.asked) {
		const id = questionNode(question.query);
		addNode(id, "question", question.query);
		for (const hit of question.hits) connect(id, `file:${hit.path}`, "found");
	}
	for (const learning of input.learnings) {
		const text = learning.notes.join(" ");
		const touched = found.namedIn(text);
		if (touched.length === 0) continue;
		const id = learningNode(learning.id);
		addNode(
			id,
			"learning",
			text.length > LABEL_LENGTH ? `${text.slice(0, LABEL_LENGTH)}…` : text,
		);
		for (const key of touched) connect(id, `topic:${key}`, "touches");
	}
	return {
		nodes: [...nodes.values()],
		edges: [...edges.values()],
		filesLeftOut: input.filesLeftOut,
		notTopics: [...input.notTopics],
	};
}
