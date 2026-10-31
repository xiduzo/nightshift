# Knowledge

Knowledge is the files your agents read in addition to the code of a
project: a wiki, web pages, Jira work items, Confluence pages, private notes.
Night Shift keeps them per project, outside the repository. They belong
to the project's Space ([ADR 4](adr/0004-knowledge-belongs-to-the-space.md)),
so every computer of the Space works on the same files.

## Where it lives

Three parts, like the flows of a project:

- **The knowledge document**, `knowledge:<project id>`: one entry per file,
  with its path, the sha256 of its content, its size, when it changed, and
  the computer that changed it. It is a Yjs document that syncs like the
  flow documents. The Space's Host keeps it, and every computer of the Space
  has a copy.
- **The content, by hash**: `<data folder>/archive/<space>/knowledge/<sha256>`.
  A computer copies new content to the Space's Host, and fetches missing
  content from there. Content never changes after Night Shift writes it. A
  Space without a Host keeps it on its one computer.
- **The folder**, `<data folder>/knowledge/<project id>/` on each
  computer: a working copy that agents and kits read and write as plain
  files. Nothing goes into the repository or into a run's copy of the
  project.

### Reconcile

Before and after each step that gets the folder (every Command step and
every Agent step), the computer that runs the step makes its folder and
the document match. The Knowledge page also does this when it reads.
While a step writes the folder, only that step reconciles it: the
Knowledge page and the retries each minute leave the folder alone until
the step ends. When steps of one project run at the same time, the first
reconciles before and the last reconciles after.

- A file the step added, changed or removed goes into the document. Its
  content goes to the Host first.
- An entry that another computer changed is fetched and written into the
  folder whole, or its file is removed.
- When both changed one path, the later change wins. A change wins over
  a removal, so nothing is lost.

A hidden file in the folder, `.reconciled.json`, holds what the folder had
at the last reconcile. `INDEX.md`, hidden files and the files a sync kit
still writes (names that end in `.part`) never sync. A file
larger than 10 MB stays on the computer that has it. The others list it,
but do not fetch it.

A computer that cannot reach its Host works on its own copy. Content it
cannot copy waits. Night Shift tries again each minute and at the next
reconcile. A file whose content it cannot fetch keeps its old version
until the next reconcile. The step continues.

The first start after the upgrade reconciles each folder a computer has,
and so publishes its files. When two computers have one path, the later
change wins.

### Who may read and change it

Every Member of the Space can read the knowledge, on any computer and on
the Host. A computer publishes its changes when its Member has a role that
may start runs. A browser changes knowledge only through flows: the syncs
and the review of learnings. In a shared Space, the Knowledge page says
that every Member can read what you sync there. Before you sync a client's
Jira or Confluence into a shared Space, make sure that each Member may see
it.

### The index

Night Shift writes `INDEX.md` at the top of the folder: one line per file,
with its path, title, first sentence and the day it changed. Night Shift
writes it again when an agent gets the folder and when the Knowledge page
reads it, if a file is newer than the index or a file came or went. A sync
does not need to write it. Each computer writes its own, and it never syncs.

`learnings/` belongs to Night Shift. What agents propose to learn waits in
`learnings/proposed/` until you accept it into `learnings/accepted/`. The
index lists only the accepted ones.

## What an agent gets

An Agent step gets the folder when the folder has files. To change that,
set `knowledge` on the Agent node: `true` gives it always, `false` never.
In the editor, this is the Knowledge section on the Setup tab.

The agent gets one line next to its prompt, not the files:

> Project knowledge is in `<folder>`. Read INDEX.md there first, then grep
> the folder for what you need. Do not change the folder.

Where the harness takes Night Shift's own tools, the agent also gets
`search_knowledge` and `read_knowledge` (see [Search](#search)), in the
run's project only, and one more line after its prompt:

> To find something in the project knowledge, call `search_knowledge` with
> a few keywords. It finds files by their words, PDF and Word files too.
> Then read a file it gives with `read_knowledge`.

| Harness | The folder | The line | Search tools |
| --- | --- | --- | --- |
| Claude Code | `--add-dir` | `--append-system-prompt` | yes, allowed without a prompt; not in plan mode |
| OpenCode | allowed as an outside folder | before the prompt | yes |
| Codex | reads any folder already (`--add-dir` would let it write) | before the prompt | yes |
| ACP agents (Copilot, Gemini, Cursor, custom agents) | read any folder already | before the prompt | yes |
| pi, Grok Build | read any folder already | before the prompt | no: no MCP. They grep the folder |

Some versions of Claude Code also load a `CLAUDE.md` in an `--add-dir`
folder. Only the line works with every version.

## Filling it

Every Command step, and every command an agent runs, gets the folder in
the environment variable `$NS_KNOWLEDGE`. A flow that writes markdown
there is a sync. To keep the knowledge current, schedule the sync. Or run
it from the Knowledge page with **Sync now**.

### Add a source on the Knowledge page

**Add source** on the Knowledge page fills the knowledge without the
canvas. Choose the kind (a folder on this computer, project files, web
pages, a GitHub wiki, Jira or Confluence) and fill in the kit's inputs.
Night Shift then:

- saves a flow that calls the kit from one Subflow node, with your values
  (`knowledge-web-pages`, then `knowledge-web-pages-2`). A source is that
  flow ([ADR 4](adr/0004-knowledge-belongs-to-the-space.md), decision 6):
  no other store holds it. The engine module `knowledgeSources`
  (`packages/engine/src/knowledge-sources`) owns every rule of a source:
  the API only checks who asks.
- gives each source its own folder in the knowledge: the kit's folder, or
  `web-2` when another flow fills `web`. A sync replaces its folder, so two
  sources never share one. The dialog does not ask for it.
- with **Keep it up to date**, adds a schedule of the flow at a time of day.
  Schedules belong to the owner of the computer, as on the Schedules page.
- with **Sync now** (on by default), starts a run of the flow.

The page lists each source with what it copies, its last sync, its
schedule and **Sync now**. A source the page made has **Edit** (the same
dialog) and **Remove**. A sync flow you drew on the canvas shows too, and
opens in the editor. **Remove** removes the flow and its schedules. If you
leave **Also remove the files it added** on, Night Shift also removes the
source's folder from the knowledge, on every computer of the Space
(`removeFolder`: its entries leave the knowledge document, and each
computer's next reconcile removes the files). A folder that another flow
fills stays. Removing files needs a role that may start runs. Night Shift
checks everything first and removes the files first. While a run changes
the knowledge, it refuses: the source stays, and you can try again.

A folder exists on one computer only. A Subflow node cannot name a Device, so a
folder source keeps its runs on the computer where you added it through
its schedule (`device`) and through **Sync now** on the Knowledge page
(`knowledge.syncSource` starts it where its schedule runs it).
A run of it started elsewhere, from the Flows page, does not find the
folder and ends with "No files to copy".

Saving a flow needs a role that may save flows. Who may write to the
knowledge stays as above: the computer that runs the sync publishes it.

Kits do the common syncs. Call one from a Subflow node:

| Kit | What it copies | Needs |
| --- | --- | --- |
| `kit:knowledge/files` | Paths or patterns of the project's own folder, one per line: `docs/private`. Files git ignores too, so private docs become knowledge without a commit. | Nothing |
| `kit:knowledge/folder` | A folder anywhere on the computer (`~/notes` or a full path), with optional patterns, one per line: `*.md`. Hidden files stay out. At most 5 000 files. | Nothing. Runs on the computer that has the folder |
| `kit:knowledge/github-wiki` | The wiki of a repository (`owner/name`), or any git address. | git, signed in for a private wiki |
| `kit:knowledge/web` | Web pages as markdown, through `r.jina.ai`. | curl, no account |
| `kit:knowledge/jira` | Jira work items, one markdown file each. | A CLI tool for `acli`, signed in, and jq |
| `kit:knowledge/confluence` | Confluence pages by id, one markdown file each. | The secret `CONFLUENCE_API_TOKEN`, curl and jq |

`kit:knowledge/review-learnings` is not a sync. See Learnings below.

Each kit writes into its own folder in the knowledge (`folder`, for
example `wiki`) and reports how many files it has. `files`, `folder` and
`github-wiki` replace the old content of their folder.

## Learnings

An agent that reads the knowledge may add `learnings` to its step report.
That is a list of short notes about the project that help the next agent.
Its report instructions say so in one sentence. The field is optional, so
an agent with nothing to say reports as before.

The computer that ran the step keeps them in
`learnings/proposed/<run id>.md`. Its reconcile after the step puts them
in the Space. They wait for you there. The index does not list them, and
no agent reads them.

The `review-learnings` starter flow calls `kit:knowledge/review-learnings`.
It opens a Gate with the proposals:

- **Keep** moves them to `learnings/accepted/`. There the index lists them
  and agents read them.
- **Delete** removes them.

A proposal that arrives while the Gate waits stays for the next review.
The Knowledge page shows how many wait, with a button that runs the review.
The review runs on any computer of the Space. Its reconcile first fetches
the proposals, and then puts what it kept or deleted back in the Space.

## Search

Each computer keeps a keyword index of its knowledge: the text files
(`.md`, `.markdown`, `.mdx`, `.txt`, `.rst`) and the text of PDF and Word
files (`.pdf`, `.docx`), not `INDEX.md`, hidden files, the files a sync
kit still writes or the learnings that wait. A PDF or Word file over 10 MB is found by its path only. The
Knowledge page has a search field. Every Agent step that gets the folder
has two tools (where its harness takes them), and so does `nightshift mcp`:

- `search_knowledge` (`query`, `limit`): the best files first, each with
  its path, title and an excerpt with the words found in bold.
- `read_knowledge` (`path`): one file, at most its first 100 KB. For a PDF
  or Word file, its text.

A step and `nightshift mcp` read a file in the same way. Night Shift
reads the copy on this computer first. When this computer does not have
the file yet, Night Shift gets its content from the Space by its hash.
Both give the text of a PDF or Word file. Neither gives the learnings
that wait for a person.

LangChain's document loaders read the text: `PDFLoader` for a PDF and
`DocxLoader` (on `mammoth`) for a Word file. Night Shift gives `PDFLoader`
the PDF.js of `unpdf`, so both work in the `nightshift` binary too. A PDF
of scanned pages has no text to find. `INDEX.md` lists a PDF or Word file
with the title the PDF gives, else the first line of its text, and its
first sentence.

Every word must match. When no file has them all, the search returns files
with some of them. A word in the title counts most, then one in the path,
then one in the text. `"a phrase"` keeps words together. `deploy*` matches
a word that starts with it, and so does the last word you type. Words
match their other forms: `deploying` finds `deploy`.

The index is in `<data folder>/knowledge/.search.sqlite` (SQLite FTS5,
BM25 ranking). It belongs to the computer. It never syncs, and you can
delete it. Before each search, Night Shift reads again only the files
whose size or time of change differ, and drops the removed ones. Thus the
index stays correct, whoever changes the folder. For 2 000 files the first
search takes about half a second, and a later one about 50 ms. It reads
the first 1 MB of a file.

An agent that gets the folder can still read `INDEX.md` and grep the
folder. In `nightshift mcp` the tools take a `project` too. In a step they
work in the run's project only.

## Size

The Knowledge page warns above 2 000 files. Nothing loads the folder into
a prompt, but an agent finds less in that much text. Sync only what your
agents need.

## Known gaps (phase 1)

- Content that no entry names any more stays in the archive. Retention is
  undecided, as it is for run history.
- A run does not record which version of the knowledge it read.
- Two steps of one run that run at the same time on two computers and
  propose learnings write one file: the later change wins.
- A project that joins another one when a computer joins its home Host
  keeps its knowledge folder under its old id.
- Search is by keyword, not by meaning: a word that is not in a file
  does not find it.
