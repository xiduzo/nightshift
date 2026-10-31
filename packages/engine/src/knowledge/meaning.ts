import type { EmbeddingsInterface } from "@langchain/core/embeddings";
import { OllamaEmbeddings } from "@langchain/ollama";

/**
 * Search by meaning: an embedding model that turns a section of the
 * knowledge, and a query, into a vector. Search finds the sections whose
 * vectors are close to the query's, besides the ones that have its words.
 *
 * It is on by itself when Ollama answers on this computer and has the
 * model. Without it, search finds words only, and nothing else changes.
 */

/** Whether this computer can embed now. */
export type KnowledgeMeaningReady = "ready" | "no-ollama" | "no-model";

/** An embedding model for the knowledge search. Tests pass a fake one. */
export type KnowledgeMeaning = {
	/** The model's name. It is part of the index: a new model builds the vectors again. */
	model: string;
	/** LangChain embeddings for the model. */
	embeddings: EmbeddingsInterface;
	/** A query as the model wants it, for example with an instruction in front. */
	query(text: string): string;
	/** Whether it can embed on this computer now. Never throws. */
	ready(): Promise<KnowledgeMeaningReady>;
	/** The least similarity (cosine) of a hit found by meaning alone. Absent: no floor. */
	floor?: number;
};

/**
 * The floor of each model: a file found by meaning alone, and less
 * similar to the query than this, is no hit. Each model has its own
 * scale. How it was chosen: `docs/research/knowledge-vectors.md` §3.4.
 */
const MEANING_FLOORS: Readonly<Record<string, number>> = {
	"qwen3-embedding:0.6b": 0.5,
};

/**
 * The default model: small (639 MB), 1 024 dimensions, and it reads Dutch
 * as well as English. See `docs/research/knowledge-vectors.md` §2.2.
 */
const KNOWLEDGE_MODEL = "qwen3-embedding:0.6b";

/**
 * The embedding model search by meaning uses: the one place that decides
 * it, beside `ollamaAddress`. Another model works too: the index takes
 * its vector size from its first vector, and a change of model builds the
 * vectors again.
 */
export function knowledgeModel(): string {
	return KNOWLEDGE_MODEL;
}

/**
 * Ollama's context for the model. With its default of 32K tokens the model
 * takes 4.8 GB of memory, with 2 048 about 1 GB. A section of 1 200
 * characters is far below 2 048 tokens.
 */
const NUM_CTX = 2048;
/** How long a check of Ollama waits for an answer. */
const PROBE_TIMEOUT_MS = 2_000;
/** How long the answer of a check holds before the next one. */
const PROBE_TTL_MS = 15_000;
/** Qwen3 embeddings want an instruction in front of a query, and nothing in front of a document. */
const QUERY_INSTRUCTION =
	"Instruct: Given a question, retrieve passages of project documentation that answer it\nQuery:";

/** A query as the model wants it: an instruction in front for Qwen3, the text as it is for others. */
const queryFor = (model: string) => (text: string) =>
	model.startsWith("qwen3-embedding") ? `${QUERY_INSTRUCTION}${text}` : text;

/** Ollama's own default address. */
const OLLAMA_DEFAULT = "http://127.0.0.1:11434";

/**
 * Where search by meaning finds Ollama: `OLLAMA_HOST` when it is set (as
 * Ollama's own CLI reads it, `host:port` or a URL), else Ollama's default.
 * The one place that decides it for the knowledge search.
 */
export function ollamaAddress(env: NodeJS.ProcessEnv = process.env): string {
	return env.OLLAMA_HOST?.trim() || OLLAMA_DEFAULT;
}

/** Search by meaning through Ollama at `ollamaAddress()`. */
export function ollamaMeaning(model = knowledgeModel()): KnowledgeMeaning {
	const embeddings = new OllamaEmbeddings({
		model,
		baseUrl: ollamaAddress(),
		keepAlive: "10m",
		requestOptions: { numCtx: NUM_CTX },
		// A refused connection is not tried six times: the search goes on without it.
		maxRetries: 1,
	});
	let checked: { at: number; ready: KnowledgeMeaningReady } | null = null;
	async function check(): Promise<KnowledgeMeaningReady> {
		try {
			const timeout = new Promise<never>((_, reject) => {
				setTimeout(
					() => reject(new Error("Ollama did not answer.")),
					PROBE_TIMEOUT_MS,
				).unref?.();
			});
			const { models } = await Promise.race([
				embeddings.client.list(),
				timeout,
			]);
			const names = new Set(models.map((m) => m.name));
			return names.has(model) || names.has(`${model}:latest`)
				? "ready"
				: "no-model";
		} catch {
			return "no-ollama";
		}
	}
	const floor = MEANING_FLOORS[model];
	return {
		model,
		embeddings,
		query: queryFor(model),
		...(floor !== undefined ? { floor } : {}),
		async ready() {
			const now = Date.now();
			if (checked && now - checked.at < PROBE_TTL_MS) return checked.ready;
			const ready = await check();
			checked = { at: Date.now(), ready };
			return ready;
		},
	};
}
