import type { Document } from "@langchain/core/documents";
import type { WaitingLearning } from "./learnings";
import type { AskedQuestion } from "./use";

/**
 * The knowledge as a graph, for the Map on the Knowledge page: the files, the
 * topics they share, the links between them, the questions that found them
 * and the learnings that name their topics.
 *
 * `TopicGraphTransformer` finds the topics by counting words and gives a
 * `GraphDocument` per file. The rest of this file reads `GraphDocument`s only.
 */

/** A file or a topic, in the `GraphDocument` of one file. */
type GraphNode = {
	/** A file's path or a topic's key. */
	id: string;
	type: "File" | "Topic";
	/** A topic as the text writes it. */
	label?: string;
};

/** What one file connects to: the topics it names and the files it links to. */
export type GraphDocument = {
	nodes: GraphNode[];
	relationships: {
		source: GraphNode;
		target: GraphNode;
		type: "MENTIONS" | "LINKS_TO";
	}[];
};

export type KnowledgeGraphNode = {
	/** `file:<path>`, `topic:<key>`, `question:<query>` or `learning:<id>`. */
	id: string;
	kind: "file" | "topic" | "question" | "learning";
	label: string;
	/** A file's path. Else null. */
	path: string | null;
	/** How many edges meet here. */
	degree: number;
};

export type KnowledgeGraphEdge = {
	id: string;
	source: string;
	target: string;
	/**
	 * `mentions`: a file names a topic. `links`: a file links to a file.
	 * `found`: a question found a file. `touches`: a learning names a topic.
	 */
	kind: "mentions" | "links" | "found" | "touches";
};

export type KnowledgeGraph = {
	nodes: KnowledgeGraphNode[];
	edges: KnowledgeGraphEdge[];
	/** Files the graph did not read, because the knowledge is so large. */
	filesLeftOut: number;
};

/** The topics of a whole graph, at most. */
const MAX_TOPICS = 24;
/** The topics one file connects to, at most. */
const TOPICS_PER_FILE = 6;
/** A learning's words on the map, at most. */
const LABEL_LENGTH = 60;
/** A topic in more of the files than this says nothing about one of them. */
const MOST_OF_THE_FILES = 0.7;

const STOP_WORDS = new Set(
	`about above after again against almost along already also although always among another answer
	because been before being below between both could does doing down during each either enough even
	every first from further have having here into itself just know last later least less like many might
	more most much must near need never next none often once only other others over part same should
	since some still such than that their them then there these they this those though three through thus
	together under until upper very want were what when where which while whole whose will with within
	without would year years your using used uses make made makes based data result results table figure
	page pages http https www html menu search privacy cookie cookies login subscribe contact home share
	blog post posts read note notes file files title time times show shows shown high higher low lower
	large small great good best better however therefore example examples article articles research paper
	papers author authors abstract keywords download view views click link links section panel fig month
	months monthly daily weekly annual annually sample samples source sources window publication published
	address january february march april june july august september october november december
	jan feb mar apr jun jul aug sep sept oct nov dec return returns index strategy strategies
	the and for but not are was has its our you this that with from
	deze voor naar maar niet door worden wordt zijn heeft hebben meer veel ook onze wij jouw`
		.split(/\s+/)
		.filter(Boolean),
);

/** The text names the words, as whole words, in any case. */
function names(text: string, words: string): boolean {
	const escaped = words.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return new RegExp(`\\b${escaped}\\b`, "i").test(text);
}

/** Text without code, links and markup. */
function plainText(text: string): string {
	return text
		.replace(/```[\s\S]*?```/g, " ")
		.replace(/`[^`]*`/g, " ")
		.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/https?:\/\/\S+/g, " ")
		.replace(/[#*_>|~=-]+/g, " ");
}

type Term = { count: number; shown: string };

/** The words that could be topics, by lower case. A name counts double. */
function termsOf(text: string): Map<string, Term> {
	const terms = new Map<string, Term>();
	const add = (shown: string, weight: number) => {
		const key = shown.toLowerCase();
		const known = terms.get(key);
		if (known) known.count += weight;
		else terms.set(key, { count: weight, shown });
	};
	const plain = plainText(text);
	// Names: "Dual Momentum", "CAGR". Not the first word of a sentence or a line.
	for (const match of plain.matchAll(
		/(?<![.!?:]\s)(?<=[ \t])([A-Z][a-zA-Z0-9]+(?:[ \t]+[A-Z][a-zA-Z0-9]+){0,2})\b/g,
	)) {
		const shown = match[1] ?? "";
		if (shown.length < 3) continue;
		if (shown.split(/\s+/).every((w) => STOP_WORDS.has(w.toLowerCase()))) {
			continue;
		}
		add(shown, 2);
	}
	for (const match of plain.matchAll(/\b[a-z][a-z-]{4,}\b/g)) {
		if (!STOP_WORDS.has(match[0])) add(match[0], 1);
	}
	return terms;
}

/** The files of the knowledge that a text links to, by path. */
function linksOf(text: string, paths: string[], self: string): string[] {
	const found = new Set<string>();
	for (const match of text.matchAll(/\]\(([^)#\s]+)|\[\[([^\]|#]+)/g)) {
		const target = (match[1] ?? match[2] ?? "").replace(/^\.?\//, "");
		if (target === "" || target.startsWith("http")) continue;
		const path = paths.find(
			(other) =>
				other === target ||
				other.endsWith(`/${target}`) ||
				other.endsWith(`/${target}.md`),
		);
		if (path && path !== self) found.add(path);
	}
	return [...found];
}

/**
 * Finds the topics of documents with `metadata.path` by counting words: the
 * words that several documents share and that say the most about them.
 */
export class TopicGraphTransformer {
	async convertToGraphDocuments(
		documents: Document[],
	): Promise<GraphDocument[]> {
		const terms = documents.map((document) => termsOf(document.pageContent));
		const seenIn = new Map<string, number>();
		const shownAs = new Map<string, string>();
		for (const list of terms) {
			for (const [key, term] of list) {
				seenIn.set(key, (seenIn.get(key) ?? 0) + 1);
				if (!shownAs.has(key) || /[A-Z]/.test(term.shown)) {
					shownAs.set(key, term.shown);
				}
			}
		}
		const most = Math.max(2, Math.ceil(documents.length * MOST_OF_THE_FILES));
		const scores = new Map<string, number>();
		for (const list of terms) {
			for (const [key, term] of list) {
				const seen = seenIn.get(key) ?? 0;
				if (seen < 2 || seen > most) continue;
				scores.set(
					key,
					(scores.get(key) ?? 0) +
						Math.log1p(term.count) * Math.log1p(documents.length / seen),
				);
			}
		}
		const topics = new Set(
			[...scores.entries()]
				.sort((a, b) => b[1] - a[1])
				.slice(0, Math.min(MAX_TOPICS, Math.ceil(documents.length * 1.5)))
				.map(([key]) => key),
		);
		const paths = documents.map(pathOf);
		return documents.map((document, index) => {
			const path = pathOf(document);
			const file: GraphNode = { id: path, type: "File" };
			const best = [...(terms[index] ?? new Map<string, Term>())]
				.filter(([key]) => topics.has(key))
				.sort((a, b) => b[1].count - a[1].count)
				.slice(0, TOPICS_PER_FILE)
				.map(
					([key]): GraphNode => ({
						id: key,
						type: "Topic",
						label: shownAs.get(key) ?? key,
					}),
				);
			const linked = linksOf(document.pageContent, paths, path).map(
				(target): GraphNode => ({ id: target, type: "File" }),
			);
			return {
				nodes: [file, ...best, ...linked],
				relationships: [
					...best.map((target) => ({
						source: file,
						target,
						type: "MENTIONS" as const,
					})),
					...linked.map((target) => ({
						source: file,
						target,
						type: "LINKS_TO" as const,
					})),
				],
			};
		});
	}
}

function pathOf(document: Document): string {
	return String(document.metadata.path);
}

/** A file's name for a person, without its folder and extension. */
function fileLabel(path: string): string {
	return (path.split("/").pop() ?? path)
		.replace(/\.[a-z0-9]+$/i, "")
		.replace(/[-_]+/g, " ");
}

/**
 * The graph of a project's knowledge: every file (read or not), what the
 * transformer found in those it read, and the questions and learnings.
 */
export function knowledgeGraphOf(input: {
	files: readonly string[];
	documents: readonly GraphDocument[];
	asked: readonly Pick<AskedQuestion, "query" | "hits">[];
	learnings: readonly Pick<WaitingLearning, "id" | "notes">[];
	filesLeftOut?: number;
}): KnowledgeGraph {
	const nodes = new Map<string, KnowledgeGraphNode>();
	const edges = new Map<string, KnowledgeGraphEdge>();
	const connect = (
		source: string,
		target: string,
		kind: KnowledgeGraphEdge["kind"],
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
		kind: KnowledgeGraphNode["kind"],
		label: string,
		path: string | null = null,
	) => {
		if (!nodes.has(id)) nodes.set(id, { id, kind, label, path, degree: 0 });
	};

	for (const path of input.files)
		addNode(`file:${path}`, "file", fileLabel(path), path);
	const topics = new Map<string, string>();
	for (const document of input.documents) {
		for (const node of document.nodes) {
			if (node.type !== "Topic") continue;
			const label = node.label ?? node.id;
			topics.set(`topic:${node.id}`, label);
			addNode(`topic:${node.id}`, "topic", label);
		}
	}
	const idOf = (node: GraphNode) =>
		node.type === "Topic" ? `topic:${node.id}` : `file:${node.id}`;
	for (const document of input.documents) {
		for (const relation of document.relationships) {
			connect(
				idOf(relation.source),
				idOf(relation.target),
				relation.type === "LINKS_TO" ? "links" : "mentions",
			);
		}
	}
	for (const question of input.asked) {
		const id = `question:${question.query}`;
		addNode(id, "question", question.query);
		for (const hit of question.hits) connect(id, `file:${hit.path}`, "found");
	}
	for (const learning of input.learnings) {
		const text = learning.notes.join(" ");
		const touched = [...topics].filter(([, label]) => names(text, label));
		if (touched.length === 0) continue;
		const id = `learning:${learning.id}`;
		addNode(
			id,
			"learning",
			text.length > LABEL_LENGTH ? `${text.slice(0, LABEL_LENGTH)}…` : text,
		);
		for (const [topic] of touched) connect(id, topic, "touches");
	}
	return {
		nodes: [...nodes.values()],
		edges: [...edges.values()],
		filesLeftOut: input.filesLeftOut ?? 0,
	};
}
