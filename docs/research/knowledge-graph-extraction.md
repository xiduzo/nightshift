# Knowledge graph extraction: what `LLMGraphTransformer` gives Night Shift

**Status:** Research, 2026-11-04. No product code. Read with
[knowledge-vectors.md](knowledge-vectors.md) and "The Map" in
[docs/knowledge.md](../knowledge.md).

Marks: **[ran]** I ran it on this Mac. **[read]** I read the source or the
paper. **[secondary]** I saw it only in a summary. A path `llm.js` is
`@langchain/community/dist/experimental/graph_transformers/llm.js`, version
1.1.29.

## 1. The answer

This section is the whole answer. The rest is the evidence.

**Do not add `LLMGraphTransformer` to the engine now.** It runs today on Bun, on
Ollama and in a compiled binary. But LangChain has sunset its package:
`@langchain/community` is deprecated on npm, and its repository is archived
(§2). The class is also thin. It extracts per document, and it does not merge,
retry, chunk or cache. It also wants a LangChain chat model. The engine has
none, and `VISION.md:56` limits where one can go (§3). The swap that `graph.ts`
prepares does not work as it stands (§4).

**A model-made graph has one good use now: the Map.** A person reads the Map, a
person forgives noise, and named relations say more than word counts. So try it
there, as a flow that writes a file. An Agent step can read a small folder
whole, which also avoids the worst problem, the duplicates between documents.

**Do not give the graph to agents yet.** The published gains are for corpora 60
to 100 times larger than claude-investor, and they shrink under fair tests. Your
agents read files and grep. claude-investor's knowledge is about 17 000 tokens
(estimate), so one agent can read all of it. The retrieval gate also cannot run:
that project has 0 marked questions, and the gate needs 20.

**The best near-term value is in the learnings, and it needs no graph.** 39
notes wait on claude-investor. In a small test, embeddings that you already have
found every duplicate and every contradiction as a close pair in 2 seconds. One
direct model question then named some of them in 7 seconds.
`LLMGraphTransformer` took 33 seconds and found none (§7).

**What I would do first:**

1. **Learnings check (option 1 in §9).** It helps today.
2. **Better topics without a model (option 0):** plurals and "not a topic"
   first.
3. **One hand-drawn flow on claude-investor (option 2).** One Agent step on
   Haiku makes the graph, and you look at it. By the estimate in §5, the model
   tokens cost cents. This is the cheapest way to learn if you want this. I did
   not run it: the brief excluded runs.
4. **Mark 20 questions** on a project you care about, then test word-count
   neighbours (§8). This answers the question about agents with no model cost.

Then decide on options 3 to 5.

## 2. What it is

`LLMGraphTransformer` is one compiled file of 190 lines, at the import path
`@langchain/community/experimental/graph_transformers/llm`. **[read]**

| Part | What the source does | Where |
| --- | --- | --- |
| Options | `llm`, `allowedNodes`, `allowedRelationships`, `prompt`, `strictMode` (default true), `nodeProperties`, `relationshipProperties`, `fallbackRelationshipType` | `dist/experimental/graph_transformers/llm.js:133` |
| Model call | Throws without `withStructuredOutput`. Calls it with a JSON Schema and no other option | `llm.js:134`, `:142` |
| Prompt | One system prompt, titled "for GPT-4", plus one human line. `prompt` replaces both | `llm.js:11-33` |
| Schema | `nodes` (`id`, `type`) and `relationships` (`sourceNodeId`, `sourceNodeType`, `relationshipType`, `targetNodeId`, `targetNodeType`). Allowed lists become enums. Properties are optional key and value lists | `llm.js:46-95` |
| Per document | One call for the whole `pageContent`. No chunking | `llm.js:151-153` |
| Many documents | A `for` loop with `await`, in order. No concurrency, no retry | `llm.js:178-185` |
| Strict mode | Filters after the call, on the lower-cased type | `llm.js:158-165` |
| Merge | None. Each document gives its own `GraphDocument` | `llm.js:166-170` |

**Its package is at its end.** LangChain sunset `@langchain/community` on
2026-05-27, and the notice says "This sunset will take effect immediately". It
also says that maintenance "has been limited" for more than a year. npm marks
the package as deprecated. The repository `langchainjs-community` is archived,
and 1.1.29 is its last release. An npm search finds no successor for this class.
**[read: issue #61, GitHub API, npm registry]** The last functional change to
this file is from 2025-01-22 (`fallbackRelationshipType`). Later commits are
chores and moves. **[ran: GitHub commit lists]**

This reaches further than this note. `GraphDocument`, `Node` and `Relationship`
in `graph.ts:2-5`, and `PDFLoader` and `DocxLoader` in `documents.ts:88`,
`:120`, come from the same package. They work at the pinned version, but no fix
comes. That needs its own decision. Do not add more to it.

The class itself is experimental by path. The reference page says nothing about
its stability. **[read]**

It needs no new package for Ollama. `@langchain/community` and
`@langchain/ollama` are engine dependencies (`packages/engine/package.json:17`,
`:21`). `ChatOllama` has `withStructuredOutput`, and its default method sends
the schema as Ollama's `format`
(`@langchain/ollama/dist/chat_models.js:589-596`, `:626`). **[read]** The
assumption from the earlier session holds.

Behaviour I checked with a fake model, with no model calls **[ran]**:

| Case | Result |
| --- | --- |
| Failure in document 3 of 4 | The whole call rejects. Documents 1 and 2 are lost |
| Same entity in two documents | Two nodes. No merge |
| Same entity twice in one document | Two nodes. No merge within a document either |
| `allowedNodes: ["Financial Metric"]` in strict mode | 0 nodes. `toTitleCase` removes the space, so the filter drops all of them (`llm.js:35`, `:161`). Use one word |
| `allowedRelationships: ["PART OF"]` | 0 relationships, for the same reason (`llm.js:120`, `:164`) |
| Relationship type "is part of" | `IS_PART OF`. `.replace(" ", "_")` changes the first space only (`llm.js:120`) |
| Node type with two spaces | Throws a TypeError (`llm.js:35`) |
| Relationship to a node that is not in `nodes` | Kept |
| Model answers `null` | An empty graph, with no error (`llm.js:155`) |

`processResponse` is public (`llm.d.ts:47`). So you can wrap it for retries,
concurrency and a cache, and you need no fork.

## 3. How a model reaches Night Shift

This is the crux. `LLMGraphTransformer` wants a LangChain chat model object.
Night Shift has none today, and its rules limit where one can go.

| Path | What it is | Where | What it means here |
| --- | --- | --- | --- |
| Harness | An Agent step drives a CLI (Claude Code, Codex, pi, ACP agents) on the person's own login. It removes `ANTHROPIC_API_KEY` from the Claude Code environment | `packages/agents/src/harnesses/`, `claude-code/harness.ts:227` | No chat model object. A step report with an Output Schema gives structured data (`session/step-report.ts`, `docs/glossary.md:162`) |
| Decider | Decision and Value nodes on TanStack AI. A Value by model calls `chat()` with an output schema, on Ollama, OpenRouter, OpenAI or a `compatible` address | `packages/agents/src/decider/decider.ts:3-5`, `:264-363`, `engine/src/graph/nodes/producers/model.ts:120-163` | Structured output in a node, with its cost on the run. Not a LangChain object |
| Embeddings | `OllamaEmbeddings` for meaning search | `packages/engine/src/knowledge/meaning.ts:5` | The only LangChain model class in the engine. It is not a chat model |

No `ChatOllama`, `ChatOpenAI`, `ChatAnthropic` or `withStructuredOutput` call
exists in `packages/` or `apps/` today. **[ran: `git grep`]**
`@langchain/anthropic` is not installed. `@langchain/openai` is only in the tree
through `@langchain/classic`.

The rule: VISION puts "Running models without a harness CLI, except a Decision
node's decider" out of scope (`docs/steering/VISION.md:56`). Value nodes and ADR
5 widened the decider. The assistant research applied the rule to the assistant
("No new model provider", `docs/research/assistant.md:29-32`).

So there are three ways to run it:

1. **`ChatOllama` in the engine.** No new package. It is a new exception to
   VISION: a chat model outside a node. Local only.
2. **A vendor chat model in the engine.** It needs `@langchain/anthropic` or
   `@langchain/openai`, an API key secret and a budget. It breaks the rule, and
   nothing on a Device holds such a key for this purpose.
3. **A `BaseChatModel` that wraps a harness session.** It keeps the rule, but a
   session is not a chat completion. It costs a process per document, and no run
   owns the budget. I would not build it.

The other route skips the class: **an Agent step or a Value node makes the same
JSON**, and a small adapter turns that JSON into `GraphDocument`s. It needs no
exception, and every existing guard applies.

## 4. What it does on real text

Test: `qwen2.5:7b` on the local Ollama, an M4 Max, Bun 1.3.10. Three paragraphs
on general investing terms, about 90 tokens each, written for this test. No
client content, no paid API. **[ran]**

**It loads and runs.** The import takes 13 ms on Bun. `bun build --compile`
built for darwin-arm64, linux-x64 and linux-arm64. The macOS binary ran a real
Ollama call and gave the right triple. I did not run the Linux binaries.

**It is slow and writes much.** Each call has about 400 tokens of prompt before
your text.

| Run (3 paragraphs) | Time per call | Input | Output | Nodes | Relations |
| --- | --- | --- | --- | --- | --- |
| No schema, 3 runs | 34 s | 522 | 571 | 26 to 29 | 19 to 22 |
| Strict schema, 3 runs | 25 s | 522 | 547 | 24 to 28 | 18 to 22 |
| Strict, `temperature: 0`, `seed: 42`, 2 runs | 32 s | 522 | 635 | 33 | 21 |
| One section of 1 126 characters, strict, 1 run | 58 s | 681 | 1 078 | 18 | 13 |

Output is 4 to 7 times the input text, because each triple repeats five JSON
keys.

**It drifts.** Names are normalized for case, space and `_` before the
comparison.

| Between 3 runs | In all 3 | In any |
| --- | --- | --- |
| Nodes, no schema | 21 | 33 |
| Relations, no schema | 6 | 41 |
| Nodes, strict schema | 19 | 33 |
| Relations, strict schema | 6 | 41 |

Temperature 0 with a seed gave the same result twice. So a fixed text, model and
seed is stable. A new model or an edit to the text still changes the result.
That matters less with a cache by content hash.

**It finds real structure.** "Dual Momentum uses relative momentum" and "Gary
Antonacci wrote best-known book" came out in every strict run. Word counting
cannot find those.

**It also makes mistakes that look like facts.** From the strict runs:

- `Spring of 2009 [Person]`, `1993 [Metric]`, `best-known book [Asset]`. An enum
  forces a type even when none fits.
- `Momentum -WORSENS-> Sharp reversals`. The text says the reverse.
- `Rule that cuts drawdown -IMPROVES-> Drawdown`.
- `dual_momentum -WROTE-> gary_antonacci`, in the run on one section. The
  direction is wrong.
- `RELATED_TO` wins when it is allowed: 10 to 17 of the 18 to 22 relations per
  run.
- At temperature 0, whole claims became nodes: `CAGR can be raised by cutting
  drawdown [Metric]`.

**It does not resolve entities.** `Sharpe ratio` and `Sharpe measure` stay
apart, and so do `CAGR` and `compound annual growth rate`. They are in different
documents, and the class reads one at a time. The same run also gives
`momentum_strategy` and `Dual Momentum`, with and without `_`. The prompt's
coreference rule (`llm.js:26-29`) cannot reach across documents. When I gave it
the three paragraphs as one document, it did merge them: one `sharpe_ratio`, one
`compound_annual_growth_rate`. The price: 18 nodes in place of 24 to 28. So
reading more at once resolves more names and finds less. Edge et al. saw the
same fall in entities with larger chunks (§A.2).

**The swap does not work as it stands.** `graph.ts:15-18` and
`docs/knowledge.md:104-106` say a model can take the place of
`TopicGraphTransformer`. That holds for the signature only. **[ran: real output
through `knowledgeGraphOf`]**

- Passed in as it is: 3 file nodes and 0 edges. `knowledgeGraphOf` reads only
  type `Topic` (`graph.ts:268`). It takes any other node for a file (`:275`),
  and it drops an edge to a node it does not know (`:249`).
- With every node forced to `Topic`: 28 topics, 16 edges, 0 edges to a file. The
  class gives no File node. The file is only in `source.metadata.path`.
- Every relation becomes `mentions` (`graph.ts:281`). The edge kinds are a fixed
  enum (`packages/api/src/knowledge/schemas.ts:294`). So the named relation, the
  whole reason to use a model, does not reach the page.
- `MAX_TOPICS` is 24 (`graph.ts:51`). At about 9 nodes per paragraph,
  claude-investor gives hundreds of nodes before merging. The Map needs a new
  way to prune.

**A long file gets thin.** One document of 44 647 characters (11 842 tokens):
two funds with a metric each, around 400 lines of filler. Each of 2 runs found 2
of the 4 names, a different pair each time, and no run found both ratios. Ollama
did not cut the text here. On this Mac the model loaded with a context of 32
768. A smaller `num_ctx` would cut it, so set it, as `meaning.ts:59` does. Chunk
     first.

## 5. Cost

Measured: about 400 tokens of prompt per call. Measured: 1 078 to 1 700 tokens
of output per 1 100 characters (one section, or three paragraphs at 570 each).
Assumed: 4 characters per token, and sections as in search (1 200 characters,
150 overlap, so one per 1 050 characters,
`docs/research/knowledge-vectors.md:39-41`). Prices: Anthropic's page on
2026-11-04, Haiku 5.5 at $0.10 in and $0.50 out, Sonnet 5.5 at $2 and $10, per
million tokens. **[read]** OpenAI's price page answered 403, so I leave it out.

**These are estimates.** The output tokens come from `qwen2.5:7b`. Another model
writes more or less.

| | claude-investor | The cap: 200 files of 60 KB |
| --- | --- | --- |
| Text | 68 981 bytes, about 17 000 tokens | 12 MB, about 3 M tokens |
| Calls, one per section | 66 | 11 429 |
| Input tokens, at 700 a call | 46 200 | 8.0 M |
| Output tokens | 71 000 to 112 000 | 12.3 M to 19.4 M |
| Haiku 5.5 | $0.04 to $0.06 | $7 to $10.50 |
| Sonnet 5.5 | $0.80 to $1.20 | $140 to $210 |
| `qwen2.5:7b` on this Mac, one at a time, 58 s a call | About 64 minutes | About 184 hours |

Arithmetic for Haiku on the cap: 8.0 M x $0.10 per million = $0.80, plus 12.3 M
to 19.4 M x $0.50 per million = $6.15 to $9.70. These figures assume a direct
API call. Night Shift has no such call, and an Agent step adds the CLI's own
context, which I did not measure.

Size of claude-investor: 17 files, 68 981 bytes, largest 12 988 bytes. **[ran:
loopback RPC, counts only]** The cap: `GRAPH_MAX_FILES` 200 and
`GRAPH_MAX_BYTES` 60 000 (`project-knowledge.ts:66-68`).

Money is not the main cost at the small end. Time on a local model is, and on a
Host it is worse. The Host image runs Ollama on the CPU
(`deploy/Dockerfile:21-24`). It has no chat model, and `qwen2.5:7b` takes 4.7 GB
on disk and 6.6 GB when loaded. **[ran]** Embedding in that image ran at 0.25 to
2.5 sections per second (`docs/knowledge.md:425-429`), against 14 on this GPU
(`knowledge-vectors.md:247`). I did not measure chat on a CPU.

For scale: GraphRAG adds gleaning rounds and community summaries. Its indexing
took 281 minutes for about 1 million tokens, on gpt-4-turbo (Edge et al.,
§4.1.3). **[read]** Its README warns: "GraphRAG indexing can be an expensive
operation". **[read]**

## 6. What the research measured

| Source | Data | Measure | Result | Does it carry over? |
| --- | --- | --- | --- | --- |
| Edge et al. 2024, GraphRAG **[read]** | Podcasts, about 1 M tokens. News, about 1.7 M. 125 questions per comparison | LLM judge, then claim counts | Graph beats vector RAG on comprehensiveness (72 to 79 % wins) and diversity (62 to 81 %). Vector RAG wins directness. Map-reduce over the raw text, with no graph, also beats vector RAG (83 and 80 % on comprehensiveness), and graph beats it only slightly | Only for "global" questions over text too large for one context (their premise, §1). Authors limit it to two corpora and call for more work (§6.1). Entity matching was exact strings (§3.1.3) |
| Zeng et al. 2025 **[read]** | Mix and other datasets, new questions | LLM judge, with position, length and trial bias removed | LightRAG's 72 to 28 win over plain RAG turns into a small loss. Gains "become much more moderate or even vanish". The best method gains under 10 % | Yes as a warning. Do not trust LLM-judge wins |
| Han et al. 2025 **[read]** | NQ, HotPotQA, MultiHop-RAG, NovelQA | F1 and accuracy | Plain RAG wins single-hop and detail questions. Graph wins multi-hop. Triple-only retrieval does badly: about 65.5 to 65.8 % of answer entities were in the graph | Yes in direction. `LLMGraphTransformer` makes triples only, the weakest form |
| Xiang et al. 2025, GraphRAG-Bench **[read]** | Novels and medical guidelines | Evidence recall, relevance, answers | Plain RAG matches or beats graph on simple facts. Graph wins on levels 2 and 3 (87.9 to 90.9 % evidence recall for HippoRAG). Prompt tokens: 879 for plain RAG, 38 707 for GraphRAG local, 331 375 for global | Partly. The best graphs here are not LangChain triples |
| Guo et al. 2024, LightRAG **[read]** | Textbooks, up to millions of tokens | LLM judge | Beats GraphRAG and plain RAG. It merges identical entities, and it adds new text without a rebuild | The incremental idea yes. The win rates fall under Zeng et al. |
| Microsoft, LazyGraphRAG **[read]** | 5 590 AP articles, 100 synthetic queries | Comprehensiveness, diversity, empowerment | Indexing costs 0.1 % of GraphRAG, by NLP noun phrases and co-occurrence, with no LLM. Quality is equal or better | Yes in idea: it favours improving the word counter. It is a vendor blog with an LLM judge, so Zeng et al. applies |

On agents that can grep:

- Sen et al. 2026 ("Is Grep All You Need?"): on 116 LongMemEval questions with
  Claude Code, Codex and Gemini CLI, grep "generally yields higher accuracy"
  than vector retrieval. The harness matters as much. Memory data, not project
  docs. **[read: abstract only]**
- Anthropic: "we suggest starting with agentic search, and only adding semantic
  search if you need faster results or more variations". **[read]**
- Against that: Cursor reports 12.5 % higher accuracy with semantic search on
  top of grep, on its own evaluation set, most of all in large codebases.
  **[read]**
- I found no study of a knowledge graph as a tool for a coding-CLI agent. I may
  have missed one.

**What this means for you.** A graph earns its place when the text is too large
for one context, and the question needs many places. At 17 000 tokens, neither
holds. At the cap of 3 million tokens, the first one does. I do not know how
many of your projects are there. Only claude-investor has files on this
computer.

## 7. What it could do, surface by surface

| Surface | What a model graph adds | Evidence | Cheaper way to most of it | Verdict |
| --- | --- | --- | --- | --- |
| (a) Map | Named things and named relations, in place of word topics | §4: real structure, with errors a person can see | Better word counter, edges by meaning | **Worth a trial** |
| (b) Agents and search | Multi-hop, related files | Works on large text, moderate in fair tests. Unmeasured for CLI agents | Grep, `search_knowledge`, `INDEX.md`, neighbours by vector | **Not yet** |
| (c) Learnings | Duplicates and conflicts | No published study found. A small test of mine, below | Embeddings for duplicates, one direct model question for conflicts | **Yes, without the transformer** |
| (d) Review queue | Group notes by what they are about, flag conflicts | No published evidence. Prototype I on branch `prototype/knowledge-page` grouped by topic | The same as (c) | **Yes, after (c)** |

**(a) The Map.** Word counting does better than its reputation here. Of the 24
topics on claude-investor, these are noise: Rules, Numbers, average, and perhaps
weight and Costs. `ETF` and `ETFs` are one topic twice. The tickers (IEF, SPY,
TLT, LQD) and Sharpe, CAGR, Momentum and drawdown are right. **[ran: RPC]** A
plural fold, a person's "not a topic", and whole phrases (`Risk Parity`, not
`Parity`) fix most of it. This project has 0 `links` edges, so its folder has
few links to follow. A cheap new edge is "close in meaning": the vectors are
already in the index (`knowledge/vectors.ts`). What word counting can never give
is the verb. If you want to read "Dual Momentum uses absolute momentum" on the
Map, that needs a model. That is a real benefit, and a fair reason to try.

**(b) Agents and search.** Agents get a line, a folder, and two tools
(`docs/knowledge.md:118-131`), and they can grep (`:457`). On claude-investor in
the last 90 days they asked 2 questions, got 3 hits in 2 files, and read none
through `read_knowledge`. **[ran: RPC]** Grep does not show up in these counts,
so real use may be higher. Still, nothing here says that retrieval is what
limits them. The three questions that failed in the vectors spike failed on
words the docs never use (`knowledge-vectors.md:236-239`). A graph made from
those docs does not add the words.

**(c) Learnings.** Today one step's notes are one decision, and notes repeat
across steps. I wrote 7 notes: two pairs that say the same thing, one note that
contradicts the first pair, two others. **[ran]**

| Way | Time | Found |
| --- | --- | --- |
| `qwen3-embedding:0.6b`, cosine of each pair | 1.9 s | Same: 0.918 and 0.750. Contradiction: 0.846 and 0.780. Highest unrelated pair: 0.486 |
| One direct question to `qwen2.5:7b` with a schema | 7 s, 259 tokens | One "same" and one "contradicts", both right. Missed the second pair of each kind. No false finding |
| `LLMGraphTransformer` with `SAME_AS`, `CONTRADICTS`, `ABOUT` | 33 s, 1 111 tokens | 0 `SAME_AS`, 0 `CONTRADICTS`. Only `ABOUT` |

A contradiction looks like a duplicate to an embedding. That is useful: the
embedding finds the pairs to look at, and a model says which kind each one is.
The graph throws the sentence away and keeps fragments such as `nightly_backtest
-ABOUT-> 40_minutes`. To find a conflict, you then need to compare values, which
is the hard part. Seven notes prove little. Pick the threshold on real notes, as
`knowledge-vectors.md` §3.4 did for the floor.

**(d) Review queue.** The rule stays: "A learning is never dismissed: a person
keeps or deletes it" (`docs/steering/DESIGN.md:108`). A model groups and flags.
It does not delete. This matches "The engine decides, the model advises"
(`VISION.md:21`).

## 8. Fit with the vision and the rules

| Rule | Flow with an Agent step | `ChatOllama` in the engine | Vendor model in the engine |
| --- | --- | --- | --- |
| No model without a harness (`VISION.md:56`) | Fits | Needs a new exception | Breaks it |
| Local first (`VISION.md:22`) | Text goes where the harness sends it. The node must say so (`harnesses/registry.ts:124`) | Fits | Text goes to the vendor |
| Who pays | The person's login, under `policy.budgetUsd` | Nobody, but it uses the computer for hours | A new key, with no run and no budget |
| Foundational (`glossary.md:113`, VISION "Tools") | Fits as a flow. A Kit holds Command and End nodes only, so this is a starter, or the Kit rule changes | Engine feature, no vendor | Vendor SDK in the engine |
| Host (ADR 15: schedules run there) | The public image has no agent CLI (`deploy/Dockerfile:21-24`). The node names a Device, or the person adds a CLI | Needs a chat model in the volume, on a CPU | Needs a key |
| Compiled binary | Nothing new | Built and ran on macOS. **[ran]** Linux built only | Not tested |
| Flows self-contained | Fits: flow, knowledge folder, profile | Not a flow | Not a flow |
| Measure before adding (`next-phase-2026-11.md:380-383`) | The Map needs no recall number. Agents do | Same | Same |
| LangChain first (owner's preference) | Does not need the sunset class | Depends on a sunset package | Depends on a sunset package |

**Privacy needs a sentence of its own.** An agent reads what it needs. An
extraction reads every file, every time. A folder can hold synced client Jira or
Confluence pages, and the docs already warn about who may see them
(`docs/knowledge.md:81-83`). A vendor-model extraction sends all of it off the
computer in one night. The node must say so, and a client project should use a
local model or skip it.

**The library saves little here, and it has no future.** You prefer a maintained
library to own code. This one is not maintained. It covers the prompt and the
schema. These stay yours: chunking, the cache, retries, merging entities, the
Map adapter, pruning and review. Take the idea of its schema, which is a few
lines of JSON Schema.

**How to measure a graph with the question set.** The set exists:
`evals/questions.json` per project (`knowledge/questions.ts:16`), tested by
`evaluateKnowledge`, with `minQuestions: 20` and `minGainPoints: 10`
(`evaluate.ts:26-35`). To test a graph:

1. Add a mode that takes the `both` hits and pulls in their graph neighbours
   (`MODES`, `evaluate.ts:83`). Test word-count neighbours first. They cost
   nothing.
2. Mark questions that need two files, and add "all answers in the top 5". Today
   one right file counts as found (`evaluate.ts:110`). So the measure cannot see
   a multi-hop gain, the one place a graph should win.
3. Keep the graph only with a gain of 10 points on at least 20 questions.

Two gaps today. claude-investor has 2 asked and 0 marked questions. **[ran]**
The 26 questions of the vectors spike (`knowledge-vectors.md:192`) are in no
branch or commit on this computer. **[ran: `git log --all`]** They need writing
again.

## 9. How it would fit

From smallest to largest:

| # | Option | Seams | Size |
| --- | --- | --- | --- |
| 0 | Better topics without a model: plurals, phrases, "not a topic", edges by meaning | `TopicGraphTransformer`, `knowledge/vectors.ts` | Days |
| 1 | Learnings check: embed notes, flag near-duplicates, ask a model about conflicts | `learnings.ts`, `meaning.ts`, Value node or Agent step | Days |
| 2 | Starter flow: one Agent step reads the folder and reports entities and relations by Output Schema, in the same shape as the class's schema. A Command writes them to a Night Shift folder. The Map reads that file | `step-report.ts`, `$NS_KNOWLEDGE`, a reserved folder like `evals/` (`folder.ts:145-150`), `graphInput`, `knowledgeGraphOf`, new edge labels in `schemas.ts:294` | A week |
| 3 | Per-file flow for a larger folder: Subflow with `each` on a Value or Agent step, skip by sha256, merge after | `glossary.md:109`, `knowledge-document.ts`, Value node | Two weeks |
| 4 | `ChatOllama` as a background job, like the vectors, with the class or with its schema copied | `knowledge/vectors.ts`, `ollama/`, a VISION change | Two weeks |
| 5 | Graph as a search mode or an agent tool | `search.ts`, `knowledgeTools`, `evaluate.ts` | Only after the gate |

A schedule fits option 2: weekly, or after a source sync, and only when a hash
changed. The knowledge document already has each file's sha256
(`docs/knowledge.md:13-17`). Store the extraction next to the hash, so an edit
costs one file.

For option 2, a schema per project goes in the flow's Output Schema. Use
single-word types (§2), and leave out `RELATED_TO`. Give the types an escape,
for example `Other`, so the enum does not force `Spring of 2009 [Person]`.

### What would change my mind

- **Toward a graph for agents:** a gain of 10 points or more on recall at 5, on
  20 or more marked questions, with word-count or model neighbours. Or a real
  night where an agent fails for want of a connection across files, and a graph
  query finds it.
- **Toward extraction in the engine:** a local chat model that does this well on
  a Host CPU in minutes, and a project that needs per-file extraction at scale.
- **Toward a larger system:** projects past about 200 000 tokens with questions
  about the whole corpus. That number is my judgement: where one Agent step can
  no longer read it all.
- **Away from the Map trial:** you open the model-made Map twice and go back to
  the Review tab. If the Map is not part of your week, its quality does not
  matter.

### Do not do this

- No `LLMGraphTransformer` inside `graphInput` or any request. That function
  reads the files during a request. Its cache is in memory, and one changed file
  changes its key (`project-knowledge.ts:205`, `:510-533`).
- No new use of `@langchain/community`. It is sunset (§2).
- No vendor SDK or API key in the engine for this. It breaks `VISION.md:56`.
- No graph database. `Neo4jGraph` and `MemgraphGraph` need a server. A file and
  a Map are enough for this scale.
- No full GraphRAG with communities and summaries. It answers global questions
  on millions of tokens, at the highest cost. Microsoft's LazyGraphRAG drops the
  LLM from indexing.
- No graph in agents' prompts or search before the gate. An agent that sees a
  result steers toward it (`docs/knowledge.md:146`), and §4 shows errors that
  read like facts.
- No extracted fact in the knowledge without a person. Extraction goes in its
  own folder, which no agent reads, and a learning still goes through Review.

## 10. What I could not check

- No run of the Agent-step flow, no paid model, no Host. Cost for a CLI session
  is unknown, because the CLI adds its own context.
- `qwen2.5:7b` is one model. A larger model may do far better on entities and
  relations.
- The test text is three short paragraphs of mine. It says nothing about recall
  on real documents.
- OpenAI's price page answered 403.
- The Linux binaries were built, not run.
- Papers: I read the sections on data, method and results, not every appendix.
  Sen et al.: abstract only.
- The report that Claude Code dropped a vector index for grep reached me only
  through **[secondary]** summaries. I do not rely on it.
- Knowledge on the Host: not looked at.

## 11. Sources

- Edge et al., "From Local to Global: A Graph RAG Approach to Query-Focused
  Summarization": https://arxiv.org/abs/2404.16130 (v2 HTML)
- Guo et al., "LightRAG": https://arxiv.org/abs/2410.05779 (v3 HTML)
- Han et al., "RAG vs. GraphRAG: A Systematic Evaluation and Key Insights":
  https://arxiv.org/abs/2502.11371 (v2 HTML)
- Xiang et al., "When to use Graphs in RAG" (GraphRAG-Bench):
  https://arxiv.org/abs/2506.05690 (v3 HTML)
- Zeng et al., "How Significant Are the Real Performance Gains? An Unbiased
  Evaluation Framework for GraphRAG": https://arxiv.org/abs/2506.06331 (v1 HTML)
- Sen et al., "Is Grep All You Need? How Agent Harnesses Reshape Agentic
  Search": https://arxiv.org/abs/2605.15184 (abstract)
- Microsoft GraphRAG README: https://github.com/microsoft/graphrag
- Microsoft Research, LazyGraphRAG:
  https://www.microsoft.com/en-us/research/blog/lazygraphrag-setting-a-new-standard-for-quality-and-cost/
- Anthropic, "Building agents with the Claude Agent SDK":
  https://www.anthropic.com/engineering/building-agents-with-the-claude-agent-sdk
- Cursor, "Improving agent with semantic search":
  https://cursor.com/blog/semsearch
- Anthropic prices, 2026-11-04:
  https://platform.claude.com/docs/en/about-claude/pricing
- LangChain JS reference:
  https://reference.langchain.com/javascript/langchain-community/experimental/graph_transformers/llm/LLMGraphTransformer
- Sunset notice: https://github.com/langchain-ai/langchainjs-community/issues/61
- Package on npm (deprecated):
  https://www.npmjs.com/package/@langchain/community
- Commit history of `llm.ts`, through the GitHub API: `langchain-ai/langchainjs`
  (`libs/langchain-community/...`, `libs/community/...`) and
  `langchain-ai/langchainjs-community` (`libs/community/...`)
- Package source, in `node_modules`: `@langchain/community` 1.1.29
  (`dist/experimental/graph_transformers/llm.js`, `llm.d.ts`),
  `@langchain/ollama` 1.3.0 (`dist/chat_models.js`).
