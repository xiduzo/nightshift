import { measuredModel, queryFor } from "./embedding-model";

/**
 * Search by meaning: an embedding model that turns a section of the
 * knowledge, and a query, into a vector. Search finds the sections whose
 * vectors are close to the query's, besides the ones that have its words.
 *
 * It is on by itself when Ollama answers and has the model: the model,
 * Ollama's address and whether Night Shift starts Ollama are the Ollama
 * vertical's (`ollama/`). Without it, search finds words only, and nothing
 * else changes.
 */

/** Whether this computer can embed now. `downloading`: the model is on its way. */
export type KnowledgeMeaningReady =
	| "ready"
	| "no-ollama"
	| "no-model"
	| "downloading";

/** What turns texts into vectors: one vector per text, or one for a query. */
export type MeaningEmbeddings = {
	embedDocuments(texts: string[]): Promise<number[][]>;
	embedQuery(text: string): Promise<number[]>;
};

/** An embedding model for the knowledge search. Tests pass a fake one. */
export type KnowledgeMeaning = {
	/** The model's name. It is part of the index: a new model builds the vectors again. */
	model: string;
	/** The embeddings of the model. */
	embeddings: MeaningEmbeddings;
	/** A query as the model wants it, for example with an instruction in front. */
	query(text: string): string;
	/** Whether it can embed now. Never throws. */
	ready(): Promise<KnowledgeMeaningReady>;
	/** Where the model runs: null on this computer, else the host name of its Ollama. */
	where?: string | null;
	/** While it is `downloading`: how far the download is, in percent. */
	downloaded?(): number | null;
	/** The least similarity (cosine) of a hit found by meaning alone. Absent: no floor (`embedding-model.ts`). */
	floor?: number;
	/** The least similarity (cosine) of two files the Map shows as close. Absent: the Map shows none (`embedding-model.ts`). */
	closeAt?: number;
	/** The least similarity (cosine) of two notes of learnings shown as close. Absent: none show (`embedding-model.ts`). */
	closeNotesAt?: number;
};

/** An embedding model as the Ollama vertical gives it: no rule of the search yet. */
type MeaningEmbedder = Pick<
	KnowledgeMeaning,
	"model" | "embeddings" | "ready" | "where" | "downloaded"
>;

/**
 * The search's model for an embedding model: how to ask it a query, and the
 * lines Night Shift measured for it (`embedding-model.ts`). A model nobody
 * measured gets no line. Null: search by meaning is off.
 */
export function measuredMeaning(
	embedder: MeaningEmbedder | null,
): KnowledgeMeaning | null {
	if (!embedder) return null;
	const { model } = embedder;
	const measured = measuredModel(model);
	const floor = measured?.floor;
	const closeAt = measured?.closeAt;
	const closeNotesAt = measured?.closeNotesAt;
	return {
		...embedder,
		query: (text) => queryFor(model, text),
		...(floor !== undefined ? { floor } : {}),
		...(closeAt !== undefined ? { closeAt } : {}),
		...(closeNotesAt !== undefined ? { closeNotesAt } : {}),
	};
}

/**
 * Whether search by meaning works for a project on this computer.
 * `off`: no model is set up. `turned-off`: a person turned it off for the
 * project. `no-ollama`: Ollama does not answer. `no-model`: Ollama does
 * not have the model. `downloading`: the model is on its way, `percent` of
 * it. `preparing`: the first vectors are on their way, `done` of `total`
 * sections. `failed`: the last preparation stopped at `done` of `total`, and
 * it tries again. `on`: every section has its vector.
 */
export type KnowledgeMeaningStatus = {
	state:
		| "off"
		| "turned-off"
		| Exclude<KnowledgeMeaningReady, "ready">
		| "preparing"
		| "failed"
		| "on";
	/** The embedding model. Null when it is off. */
	model: string | null;
	done: number;
	total: number;
	/** Where the model runs: null on this computer, else the host name of its Ollama. */
	where: string | null;
	/** While `downloading`: how far the download of the model is, in percent. */
	percent: number | null;
};

/**
 * Whether a person left search by meaning on for a project, from what
 * reads the project's setting (`sync/domain/entry.ts`). A setting that
 * cannot be read leaves it on. No reader: on for every project.
 */
export function leftOn(
	read?: (projectId: string) => Promise<boolean>,
): (projectId: string) => Promise<boolean> {
	return (projectId) =>
		read ? read(projectId).catch(() => true) : Promise.resolve(true);
}
