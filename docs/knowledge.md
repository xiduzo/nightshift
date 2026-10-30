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

- A file the step added, changed or removed goes into the document. Its
  content goes to the Host first.
- An entry that another computer changed is fetched and written into the
  folder whole, or its file is removed.
- When both changed one path, the later change wins. A change wins over
  a removal, so nothing is lost.

A hidden file in the folder, `.reconciled.json`, holds what the folder had
at the last reconcile. `INDEX.md` and hidden files never sync. A file
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

| Harness | The folder | The line |
| --- | --- | --- |
| Claude Code | `--add-dir` | `--append-system-prompt` |
| OpenCode | allowed as an outside folder | before the prompt |
| Codex | reads any folder already (`--add-dir` would let it write) | before the prompt |
| ACP agents, pi, Grok Build | read any folder already | before the prompt |

Some versions of Claude Code also load a `CLAUDE.md` in an `--add-dir`
folder. Only the line works with every version.

## Filling it

Every Command step, and every command an agent runs, gets the folder in
the environment variable `$NS_KNOWLEDGE`. A flow that writes markdown
there is a sync. To keep the knowledge current, schedule the sync. Or run
it from the Knowledge page with **Sync now**.

Kits do the common syncs. Call one from a Subflow node:

| Kit | What it copies | Needs |
| --- | --- | --- |
| `kit:knowledge/files` | Paths or patterns of the project's own folder, one per line: `docs/private`. Files git ignores too, so private docs become knowledge without a commit. | Nothing |
| `kit:knowledge/github-wiki` | The wiki of a repository (`owner/name`), or any git address. | git, signed in for a private wiki |
| `kit:knowledge/web` | Web pages as markdown, through `r.jina.ai`. | curl, no account |
| `kit:knowledge/jira` | Jira work items, one markdown file each. | A CLI tool for `acli`, signed in, and jq |
| `kit:knowledge/confluence` | Confluence pages by id, one markdown file each. | The secret `CONFLUENCE_API_TOKEN`, curl and jq |

`kit:knowledge/review-learnings` is not a sync. See Learnings below.

Each kit writes into its own folder in the knowledge (`folder`, for
example `wiki`) and reports how many files it has. `files` and
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
(`.md`, `.markdown`, `.mdx`, `.txt`, `.rst`), not `INDEX.md`, hidden files
or the learnings that wait. The Knowledge page has a search field, and
`nightshift mcp` has two tools for an agent:

- `search_knowledge` (`query`, `limit`): the best files first, each with
  its path, title and an excerpt with the words found in bold.
- `read_knowledge` (`path`): one file, at most its first 100 KB.

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

An agent that gets the folder still reads `INDEX.md` and greps the folder.
To give a node search, add the `nightshift` MCP server as a connection.

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
