/**
 * The embedding models Night Shift measured, each as one record: what a model
 * trial must establish, in one place. A model that is not here still works,
 * through the Settings page, but gets no floor: its similarity has its own
 * scale, and a floor that nobody measured would hide right files.
 *
 * A trial is one record plus one floor run, as in
 * `docs/research/knowledge-vectors.md` §3.4. A model nobody has measured gets
 * no record: `docs/knowledge.md` lists the ones to watch.
 */
export type EmbeddingModel = {
	/** The name as Ollama knows it. */
	name: string;
	/** The length of a vector, in the measurement. */
	dims: number;
	/**
	 * What goes in front of a query. Null: nothing. Documents get nothing
	 * either way. This is a fact of the model, so other sizes of it get it too.
	 */
	instruct: string | null;
	/** The least similarity (cosine) of a hit found by meaning alone. */
	floor: number;
	/** The corpus and the day of the measurement of `floor`, and where it is written. */
	measuredOn: string;
};

const QWEN3: EmbeddingModel = {
	name: "qwen3-embedding:0.6b",
	dims: 1024,
	instruct:
		"Instruct: Given a question, retrieve passages of project documentation that answer it\nQuery:",
	floor: 0.5,
	measuredOn:
		"This repository's docs/, 42 files, 1 153 sections, 2026-10-31: docs/research/knowledge-vectors.md §3.4. Checked with the heading path, 55 files, 1 413 sections, 2026-11-04: docs/knowledge.md",
};

/** The model of search by meaning when the owner of the computer picks none. */
export const DEFAULT_EMBEDDING_MODEL = QWEN3.name;

const MEASURED: readonly EmbeddingModel[] = [QWEN3];

/** The record of exactly this model. Undefined: it was not measured, so it has no floor. */
export const measuredModel = (name: string) =>
	MEASURED.find((model) => model.name === name);

/** A query as the model wants it: with the instruction of its family, if it has one. */
export function queryFor(name: string, text: string): string {
	const family = (model: string) => model.split(":")[0];
	const instruct = MEASURED.find(
		(model) => family(model.name) === family(name),
	)?.instruct;
	return instruct ? `${instruct}${text}` : text;
}
