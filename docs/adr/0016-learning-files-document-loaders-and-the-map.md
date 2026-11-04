# 16. One learning file per step, own document loaders, a Map with no model

Status: accepted, 2026-11-05. Amends decision 5 of
[ADR 4](0004-knowledge-belongs-to-the-space.md), which stays as written.

## Context

The architecture review of the Knowledge module (2026-11) changed or confirmed
three things that a later reader would not expect.

**The file name of a proposed learning.** ADR 4 decision 5 names the file
`learnings/proposed/<runId>.md`, because "one run writes one proposal file, so
proposals from two Devices never touch the same path". That is not true of a
run whose steps walk on two Devices. Two steps then write one path on two
computers, the later change wins, and the notes of the other step are lost.

**`@langchain/community`.** The engine used it for its PDF and Word loaders and
its graph types. The package is deprecated, and its repository has been archived
since 2026-05-27. It also brings a vendor SDK. Night Shift stays inside the
shapes of LangChain.js where they are maintained: `Document`,
`BaseDocumentLoader`, the text splitters, `Embeddings`, `VectorStore`,
`RecordManagerInterface`, `index()`.

**The Map.** It read each file again at each draw, and `LLMGraphTransformer` was
the obvious way to make it better.
[The research](../research/knowledge-graph-extraction.md) advises against that
transformer. A model in the engine would also need an answer before the page
can open.

## Decision

1. **A proposed learning has one file per step:**
   `learnings/proposed/<runId>.<stepId>.md`. This amends ADR 4 decision 5. The
   file of a run from before this rule (`<runId>.md`) stays valid and still
   waits for a person. A Command names its own file, with the same form.
2. **`@langchain/community` left the engine.** `PdfLoader` and `DocxLoader` are
   small classes on `BaseDocumentLoader` from `@langchain/core`. They call `unpdf`
   and `mammoth`, which have no native parts, so the `nightshift` binary carries
   them. Their `Document`s go to the splitter as before.
3. **The Map reads the search index, with no model.** It draws the sections and
   the stored vectors that this computer's index holds. Topics come from counting
   words. It asks neither a model nor the Host. A Map that a model makes would be a
   flow that writes a file, and the engine has no seam for one.

## Consequences

- Two steps of one run on two computers keep both their notes.
- Night Shift owns two small loaders. A change in `unpdf` or `mammoth` is its own
  work, and nothing waits on a package that no one maintains.
- The Map opens when the Host is down or Ollama does not answer. Its topics are
  plain counts. They find what files share by name, not what they mean. A person
  can mark a word as not a topic. The edges of meaning come from the vectors,
  when the model has a measured line.
- Drawing at the size limits takes more than a second on the daemon's thread.
  So the Map keeps the last drawing of each project until what it read changes
  (`docs/knowledge.md`, "The Map").
