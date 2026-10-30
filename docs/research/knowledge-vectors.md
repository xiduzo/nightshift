# Knowledge vectors: find by meaning, and when it is worth it

**Status:** Written spike, 2026-10-30. No product code. Read with
`next-phase-2026-11.md` §5.1 and §5.2, [ADR 4](../adr/0004-knowledge-belongs-to-the-space.md)
and `packages/engine/src/knowledge/search.ts`. The throwaway prototype is on
branch `s4/vectors`, in `scratch/vectors/` and `scratch/compile/`. It never
lands.

## 1. Decision

The three choices that §5.1 and §5.2 wait for:

| Choice | Decision |
| --- | --- |
| Embedding model | `qwen3-embedding:0.6b` through Ollama, 1024 dimensions, `num_ctx` 2048 |
| Store | float32 BLOBs in a `chunks` table of the existing bun:sqlite index file, `<dataDir>/knowledge/.search.sqlite`, searched by an exact scan in JS |
| Threshold | Offer vectors when keyword recall@5 is below 80 % on at least 20 marked questions. Keep them on only when hybrid recall@5 is at least 10 points higher than keyword recall@5 |

In five lines:

1. Cut each text file by markdown heading with `@langchain/textsplitters`, and embed the chunks with `@langchain/ollama` and `qwen3-embedding:0.6b`.
2. Keep the vectors next to FTS5 in the same bun:sqlite file, and scan them exactly. No extension, no native addon, nothing new for `bun build --compile`.
3. Keep the index current with `index()` from `@langchain/core/indexing`, through two small classes on bun:sqlite: a record manager and a vector store.
4. Fuse keyword and vector hits with reciprocal rank fusion (RRF, c = 60), in `search.ts`, by file path. `KnowledgeHit` does not change.
5. Turn it on per project, from the measurement of §5.1. On this repo's docs, vectors found 23 of 26 answers in the top 5, keyword search 16 to 19.

## 2. The pieces

### 2.1 Chunks: `@langchain/textsplitters` 1.0.2

- `RecursiveCharacterTextSplitter.fromLanguage("markdown", { chunkSize, chunkOverlap })`
  splits at `\n## `, then `\n### ` down to `######`, then code fences, rules,
  paragraphs, lines and words. It is the splitter to use.
- `MarkdownTextSplitter` is the same splitter with the markdown separators.
- LangChain.js has no `MarkdownHeaderTextSplitter`. Only Python has it. The
  heading path does not go into the metadata. To keep it, read the heading
  lines above the chunk's offset. The prototype puts the file's title in
  front of each chunk instead.
- Chunk size: 1 200 characters with 150 overlap gave 1 101 chunks for 36
  files (835 KB). 600 characters gave 2 182 chunks, two times the index
  time, and two answers fewer for vectors. Use 1 200.

### 2.2 Embeddings: `@langchain/ollama` 1.3.0

`new OllamaEmbeddings({ model, baseUrl, dimensions, keepAlive, truncate, requestOptions: { numCtx } })`.
It calls Ollama's `/api/embed`. It adds no task prefix: the caller adds it.

| Model | Download | Dims | Context | Languages | License | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `qwen3-embedding:0.6b` | 639 MB | 1024, MRL from 32 | 32K | 100+, Dutch included | Apache-2.0 | MTEB multilingual 64.33. Query gets `Instruct: <task>\nQuery:<text>`, documents get nothing |
| `nomic-embed-text` (v1.5) | 274 MB | 768, MRL to 64 | 2K in Ollama | English | Apache-2.0 | Needs `search_query: ` and `search_document: ` prefixes |
| `bge-m3` | 1.2 GB | 1024 | 8K | 100+ | not checked | Two times the download of qwen3 0.6b |

Why `qwen3-embedding:0.6b`: it handles Dutch, it is small, and it is the
newest of the three. On this repo's English docs it tied with
`nomic-embed-text` (23 of 26 both). The Dutch questions here are only three,
and they share words like "GitHub Actions" with the docs, so they do not
separate the models. A Dutch knowledge folder needs the multilingual model.
`bge-m3` stays the fallback if a project's evaluation shows misses.

Set `numCtx` to 2048. With Ollama's default context of 32K, the loaded
model took 4.8 GB of memory on this Mac. With 2048 it took 988 MB. A chunk
of 1 200 characters is far below 2 048 tokens.

`dimensions: 256` (MRL) cut the vector file from 5.0 MB to 1.5 MB and lost
one answer (22 of 26). Keep 1024 dimensions. Disk is cheap at this size.
Use 256 only for a very large project.

### 2.3 Incremental index: the indexing API

`index({ docsSource, recordManager, vectorStore, options: { cleanup, sourceIdKey } })`
is in `@langchain/core/indexing`, which the engine already depends on. It
hashes each chunk (sha256 of text and metadata) into its id. It asks the
record manager which ids exist, embeds only the new ones, and deletes the
ids of a source that no longer come back.

Record managers in JS:

| Record manager | Package | On Bun |
| --- | --- | --- |
| `PostgresRecordManager` | `@langchain/community/indexes/postgres` | Needs Postgres. No |
| `SQLiteRecordManager` | `@langchain/community/indexes/sqlite` | Uses `better-sqlite3`, a native addon. Bun 1.3.10 crashed on load here (`NAPI FATAL ERROR`). No |
| In-memory | `@langchain/community/indexes/memory` | Lost on restart. No |

So Night Shift writes its own: `RecordManagerInterface` is six methods
(`createSchema`, `getTime`, `update`, `exists`, `listKeys`, `deleteKeys`).
The prototype's `BunSqliteRecordManager` is 40 lines on bun:sqlite.

The vector store must keep the ids that `index()` gives it and delete by
them. The LangChain stores that fit Bun do not:

- `LibSQLVectorStore` ignores the `ids` option. It returns rowids, and
  `delete({ ids })` runs `WHERE rowid = :id`. With `index()`, old chunks
  are never deleted.
- `MemoryVectorStore` (now in `@langchain/classic`) has no `delete`. The
  base method throws "Not implemented".

So the prototype has a `BunSqliteVectorStore` (40 lines) that extends
`VectorStore` from `@langchain/core`. With both classes, `index()` did the
right thing, also inside a compiled binary:

| Run | Added | Deleted | Skipped | Embedded |
| --- | --- | --- | --- | --- |
| First, 3 files | 10 | 0 | 0 | 10 |
| Again, nothing changed | 0 | 0 | 10 | 0 |
| One file edited | 2 | 2 | 8 | 2 |
| One file removed (`cleanup: "full"`) | 0 | 3 | 7 | 0 |

Two traps:

- **Time must go up.** `index()` deletes the records of a seen source
  that are older than the time it started. Two refreshes in one clock tick
  share a time, and the old chunks stay. The compiled binary hit this with
  `Date.now()`. `getTime` must return a value strictly greater than the
  last. `SQLiteRecordManager` uses whole seconds, so it has the same bug.
- **Removed files need `full` or a manual delete.** `incremental` cleans
  only the sources it sees. A removed file is not seen. Either pass all
  chunks with `cleanup: "full"` (splitting is cheap, and unchanged chunks
  skip), or delete by group: `listKeys({ groupIds: [path] })`, then
  `vectorStore.delete` and `deleteKeys`.

How it maps to ADR 4:

- `sourceIdKey: "path"`. The record manager's group id is the file's path.
- The `knowledge:<projectId>` document already holds each file's sha256.
  `search.ts` compares size and time of change today. With vectors, it
  passes only the files whose sha256 changed to `index()`. A file whose
  hash did not change is not even split.
- Do not put the file's hash into the chunk metadata. Then an edit
  embeds only the chunks whose text changed, not every chunk of the file.
- The model name and dimensions are part of the index version
  (`SCHEMA_VERSION` plus a `meta` row). A new model drops the chunks and
  builds them again.
- The index stays per Device (decision 7). Each Device embeds its own
  working copy. Embeddings are keyed by the content of the chunk, so they
  could travel through the Host archive later (§5.2, open question). That
  saves index time only. A Device still needs Ollama to embed the query.

### 2.4 Store: what survives `bun build --compile`

Each store was run with `bun` and as a compiled binary on this Mac (Bun
1.3.10, macOS 27, M4 Max). The Linux binaries were built for
`bun-linux-arm64`. Docker was not running, so they were not run in the
Host's Wolfi image.

| Store | `bun` on macOS | Compiled, macOS | Linux | Verdict |
| --- | --- | --- | --- | --- |
| BLOBs in bun:sqlite, exact scan | Works | Works | Built. Pure JS on Bun's own SQLite | **Use** |
| sqlite-vec 0.1.9 via `loadExtension` | Fails: "This build of sqlite3 does not support dynamic extension loading" | Fails: the `.dylib` is not in the binary | Bun links SQLite statically on Linux, so loading works. The `.so` must be embedded and written to disk first | No |
| sqlite-vec with `Database.setCustomSQLite` | Works with Homebrew's `libsqlite3.dylib` | Needs a `.dylib` shipped beside the binary | Not needed | No |
| libsql vectors (`F32_BLOB`, `libsql_vector_idx`, `vector_top_k`) | Works, FTS5 too | Fails as is. Works with the libsql plugin of `apps/server/scripts/build-binary.ts` | The plugin already embeds libsql for linux-x64 and linux-arm64 | Next step for very large projects |
| `hnswlib-node`, `faiss-node`, LanceDB, `usearch` | Not tried | Native addons, each with its own loader | Same | No |

Why the exact scan: a project's knowledge is small for a vector index. At
20 000 chunks of 1024 dimensions, the scan took 52 ms, and loading the
vectors from SQLite took 192 ms once. The matrix then stays in memory (80
MB). Below about 50 000 chunks, an approximate index buys nothing.

Why not sqlite-vec: macOS blocks extensions in Apple's SQLite, which Bun
uses. Night Shift would ship a second SQLite, and on Linux write the
extension out of the binary before each start. sqlite-vec is also an alpha
(v0.1.x).

Why libsql second: it works in the binary today and has an approximate
index (DiskANN). But the search index is in bun:sqlite. Moving vectors to
libsql puts keyword and vector hits in two files. If a project outgrows the
exact scan, move the whole search file to libsql, FTS5 included. libsql
has FTS5.

### 2.5 Hybrid: RRF in `search.ts`

`EnsembleRetriever` is in `@langchain/classic` now ("Old abstractions from
LangChain.js", 12 MB, depends on `@langchain/openai`). It computes weighted
RRF with c = 60. It merges by `pageContent`. FTS returns a file with a
snippet and vectors return a chunk, so each side must be wrapped to return
one `Document` per path. It also drops the scores and the snippets.

The prototype used it with those wrappers, and it works. In `search.ts`,
write the same formula: for each list, add `weight / (rank + 60)` to the
file's score, then sort. It is ten lines, keeps the `KnowledgeHit` fields,
and needs no new package.

Weights hardly matter at c = 60: 0.5/0.5, 0.3/0.7 and 0.2/0.8 gave the same
recall.

## 3. The numbers

### 3.1 Set-up

- Corpus: this repo's `docs/`, 36 text files, 835 KB, copied into a
  knowledge folder.
- 26 questions with the files that answer them (`scratch/vectors/questions.ts`):
  10 that share words with the answer, 13 paraphrases that share none or
  almost none, and 3 in Dutch.
- Each question also has a keyword form, what an agent would type
  (`kw`).
- Keyword search is `createKnowledgeSearch` from `search.ts`, unchanged.
- A hit is a right file in the top 5. MRR@10 is the mean of 1 / rank of the
  first right file.
- Ollama 0.40.13 on an M4 Max (GPU).

### 3.2 Recall@5

`qwen3-embedding:0.6b`, 1024 dims, chunks of 1 200 characters:

| Method | All (26) | Keyword (10) | Paraphrase (13) | Dutch (3) | MRR@10 |
| --- | --- | --- | --- | --- | --- |
| FTS5, the question as typed | 16 | 7 | 7 | 2 | 0.37 |
| FTS5, keyword form | 19 | 10 | 7 | 2 | 0.62 |
| Vector, the question | **23** | 9 | **11** | 3 | 0.71 |
| Hybrid, the question for both | 20 | 9 | 8 | 3 | 0.58 |
| Hybrid, keyword form for FTS5 | 22 | 9 | 10 | 3 | **0.76** |

Other runs, vector and best hybrid only:

| Variant | Vector | Hybrid (keyword form) |
| --- | --- | --- |
| `nomic-embed-text`, 768 dims | 23 | 23 |
| `qwen3-embedding:0.6b`, 256 dims | 22 | 22 |
| `qwen3-embedding:0.6b`, chunks of 600 | 21 | 22 (MRR 0.79) |

What it says:

- Keyword search misses paraphrases: 7 of 13. Vectors find 11.
- An agent that types keywords gets much more from FTS5 (19) than one
  that types the question (16). The "every word, else any word" rule
  makes a whole question noisy.
- Hybrid does not beat vectors here. A noisy keyword list pulls good vector
  hits down. Hybrid has the best first rank (MRR) when the keyword side gets
  keywords. Agents type keywords, so hybrid is the right default.
- Hybrid keeps exact words that vectors miss: "Is Windows supported?" was
  rank 5 for FTS5 with keywords and out of the top 10 for vectors.
- Three questions failed everywhere: "a helper with the same nickname"
  (profiles), "the program upgrades itself" (app updates) and "suggested
  lessons" (learnings). These need words that the docs never use for the
  thing.

### 3.3 Cost

Measured on the M4 Max:

| What | Value |
| --- | --- |
| Embed 1 101 chunks, qwen3 0.6b | 78.7 s (14 chunks/s) |
| Embed 1 101 chunks, nomic | 53.3 s (21 chunks/s) |
| Vectors on disk, 1024 dims | 5.0 MB, 4.6 KB a chunk |
| Vectors on disk, 256 dims | 1.5 MB |
| FTS5 index of the same text | 1.8 MB, 46 ms to build |
| Query embedding, warm | 23 ms p50, 160 ms p95 |
| Query embedding, model not loaded | 0.8 s |
| Exact scan, 1 101 chunks | 1.2 ms |
| Exact scan, 20 000 × 1024 | 52 ms, 80 MB in memory |
| FTS5 search | 14 ms p50 |

Estimate for 1 000 files of 8 KB (about 10 000 chunks): 12 minutes to embed
on this Mac, 46 MB of vectors plus the chunk text, a 25 ms scan, and about
50 ms a query with the embedding. A Host without a GPU is not measured.
Expect it to be several times slower. The first index runs once. Later
refreshes embed only changed chunks.

## 4. The evaluation plan (§5.1)

### 4.1 The question set

A person makes it on the Knowledge page, from "Questions agents asked":

1. Pick about 20 questions. Take most of them from real agent queries.
2. Add a few that a newcomer would ask in their own words. Use other
   words than the docs use.
3. Add a few in Dutch if the team writes or asks in Dutch.
4. Mark each question with the file or files that answer it. A question
   with no answering file does not count.
5. Look at the set again after a large change to the knowledge.

The set is kept under `evals/` in the knowledge document. It syncs, and the
index never reads it (§5.1).

### 4.2 The measure

A plain recall@k function in the engine. For each question, run keyword,
vector and hybrid search with the query as asked. Report recall@5 and the
rank of the first right file. It needs no model to grade and gives the same
result each time. It runs on every Device, with no account.

- **`openevals`** (0.2.3) adds an LLM judge: `createLLMAsJudge` with
  `RAG_RETRIEVAL_RELEVANCE_PROMPT`. Its judge can be any LangChain chat
  model, so a local Ollama model works. Use it later for queries that no
  person marked. It is not needed for the threshold.
- **`agentevals`** (0.0.7) grades agent trajectories, not retrieval. Not
  for this.
- **LangSmith** `evaluate()` needs a LangSmith dataset and an API key, and
  stores the experiment in LangSmith. It cannot be the default. It is an
  opt-in place to send results, as in the plan.

### 4.3 The threshold

1. Run the evaluation on at least 20 marked questions.
2. If keyword recall@5 is 80 % or higher, the page says keyword search finds
   enough. Vectors stay off.
3. If it is below 80 %, the page offers vectors. When Ollama is there,
   the evaluation also runs vector and hybrid search.
4. Keep vectors on when hybrid recall@5 is at least 10 points higher than
   keyword recall@5 (2 questions of 20). Otherwise say that vectors did
   not help, and turn them off.

On this repo's docs: keyword 73 % (keyword form), hybrid 85 %, vector 88 %.
Vectors would turn on.

## 5. What changes in `search.ts`

The port stays: `createKnowledgeSearch(dataDir)` returns `refresh`,
`search`, `read` and `close`. `KnowledgeHit` keeps its fields.

1. **Construction.** `createKnowledgeSearch(dataDir, { semantic?: { embeddings, model, dims } })`.
   The daemon passes an `OllamaEmbeddings` when the Settings switch is on.
   Tests pass `FakeEmbeddings`. Without `semantic`, nothing changes.
2. **Schema.** `SCHEMA_VERSION` goes to 2. New tables in the same file:
   `chunks` (id, file id, order, offset, text, vec BLOB), `records` (the
   record manager) and `meta` (model and dims). A different model or dims
   drops `chunks` and `records`.
3. **Refresh.** The FTS5 part stays as it is. Then, for the changed files,
   split them and call `index()` with `sourceIdKey: "path"`. For removed
   files, delete by group. Embedding runs after the SQLite transaction, in
   batches of 32, and never inside it.
4. **Embedding does not block search.** A first index can take minutes. A
   search uses the vectors that exist, and the rest is found by keywords
   only. The refresh embeds in the background, one project at a time, like
   `refreshing` today.
5. **Search.** Embed the query with the instruction prefix. Scan the
   project's matrix (cached, and dropped when the refresh changes chunks).
   Score a file by its best chunk. Fuse with the FTS5 list by RRF. The
   snippet is the FTS5 snippet when there is one, else the start of the
   best chunk, with no `match` parts. `score` is the RRF score.
6. **No Ollama.** When Ollama does not answer, search is keyword only and
   logs it once. The page says how to turn vectors on.

Plan §5.2 also wants keyword search to use the same chunks, so a hit
points at a section. That fits: a `texts` row per chunk instead of per
file, with the same chunk ids. It is a separate change from vectors.

## 6. Risks

- **Small corpus.** 36 files make the top 5 easy. A folder of 2 000 files
  will give lower numbers for every method. The decision is per project for
  that reason.
- **Questions written by the spike.** The keyword forms were written by
  someone who knew the answers. Real agent queries (§5.1) are the honest
  input.
- **Dutch is barely tested.** Three questions. The model choice rests on
  its published multilingual support, not on this run.
- **Ollama memory.** Without `numCtx` 2048, qwen3 0.6b loads at 4.8 GB.
  On a Host, a sidecar Ollama container must set it too.
- **Host without a GPU.** Index time is not measured on CPU. The first index
  of a large project can take a long time. It runs in the background.
- **Each Device embeds its own copy.** Ten Devices embed the same files ten
  times. Sharing embeddings by content hash through the Host is the open
  question of §5.2.
- **LangChain store bugs.** `LibSQLVectorStore` ignores ids, and
  `SQLiteRecordManager` uses whole seconds and a native addon. The two
  small classes avoid both. Pin `@langchain/core`: `index()` is the
  contract.
- **The Linux binary was not run.** It was built, not run in Wolfi. Run the
  compiled test in the Host image before §5.2 lands.

## 7. Sources

- Bun SQLite (`loadExtension`, `setCustomSQLite`, Apple's SQLite, static
  linking): https://bun.com/docs/runtime/sqlite
- Bun executables, embedding `.node` files (mirror of the bun-types docs):
  https://app.unpkg.com/bun-types@1.2.2/files/docs/bundler/executables.md
- Bun Node-API: https://bun.com/docs/runtime/node-api
- sqlite-vec in JS and Bun: https://alexgarcia.xyz/sqlite-vec/js.html
- libSQL and Turso vectors: https://docs.turso.tech/features/ai-and-embeddings
- LangChain.js Ollama embeddings:
  https://docs.langchain.com/oss/javascript/integrations/text_embedding/ollama
- LangChain.js splitters:
  https://docs.langchain.com/oss/javascript/integrations/splitters/code_splitter
- LangChain.js `RecordManagerInterface`:
  https://reference.langchain.com/javascript/langchain-core/indexing/RecordManagerInterface
- Ollama models: https://ollama.com/library/qwen3-embedding,
  https://ollama.com/library/nomic-embed-text, https://ollama.com/library/bge-m3
- Qwen3-Embedding-0.6B model card: https://huggingface.co/Qwen/Qwen3-Embedding-0.6B
- nomic-embed-text v1.5 model card: https://huggingface.co/nomic-ai/nomic-embed-text-v1.5
- openevals: https://github.com/langchain-ai/openevals
- LangSmith RAG evaluation: https://docs.langchain.com/langsmith/evaluate-rag-tutorial
- Package sources read for this spike, in `node_modules`:
  `@langchain/core` 1.3.2 (`indexing/base.js`, `vectorstores.js`),
  `@langchain/community` 1.1.29 (`vectorstores/libsql.js`, `indexes/sqlite.js`),
  `@langchain/classic` 1.0.57 (`retrievers/ensemble.js`, `vectorstores/memory.js`),
  `@langchain/textsplitters` 1.0.2, `@langchain/ollama` 1.3.0, `openevals` 0.2.3.
