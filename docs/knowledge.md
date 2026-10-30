# Knowledge

Knowledge is the files your agents read besides the code of a project:
a wiki, web pages, Jira work items, Confluence pages, private notes.
Night Shift keeps them per project, outside the repository, on each
computer that runs steps.

## Where it lives

`<data folder>/knowledge/<project id>/` on the computer that runs the step.
Each computer has its own folder (phase 1). Nothing goes into the
repository or into a run's copy of the project.

Night Shift writes `INDEX.md` at the top of the folder: one line per file,
with its path, title, first sentence and the day it changed. It writes it
again when a file is newer than it, or a file came or went, at the moment
an agent gets the folder and when the Knowledge page reads it. A sync does
not need to write it.

`learnings/` is Night Shift's own: what agents propose to learn waits in
`learnings/proposed/` until you accept it into `learnings/accepted/`. The
index lists the accepted ones only.

## What an agent gets

An Agent step gets the folder when it has files. Set `knowledge` on the
Agent node to change that: `true` gives it always, `false` never. In the
editor it is the Knowledge section on the Setup tab.

The agent gets one line next to its prompt, not the files:

> Project knowledge is in `<folder>`. Read INDEX.md there first, then grep
> the folder for what you need. Do not change the folder.

| Harness | The folder | The line |
| --- | --- | --- |
| Claude Code | `--add-dir` | `--append-system-prompt` |
| OpenCode | allowed as an outside folder | before the prompt |
| Codex | reads any folder already (`--add-dir` would let it write) | before the prompt |
| ACP agents, pi, Grok Build | read any folder already | before the prompt |

`--add-dir` can also make Claude Code load a `CLAUDE.md` in the folder,
depending on its version. The line is the reliable path.

## Filling it

Every Command step, and every command an agent runs, gets the folder in
the environment variable `$NS_KNOWLEDGE`. A flow that writes markdown
there is a sync. Schedule it to keep the knowledge fresh, or run it from
the Knowledge page with **Sync now**.

The kits do the common syncs. Call one from a Subflow node:

| Kit | What it copies | Needs |
| --- | --- | --- |
| `kit:knowledge/files` | Paths or patterns of the project's own folder, one per line: `docs/private`. Files git ignores too, so private docs become knowledge without a commit. | Nothing |
| `kit:knowledge/github-wiki` | The wiki of a repository (`owner/name`), or any git address. | git, signed in for a private wiki |
| `kit:knowledge/web` | Web pages as markdown, through `r.jina.ai`. | curl, no account |
| `kit:knowledge/jira` | Jira work items, one markdown file each. | A CLI tool for `acli`, signed in, and jq |
| `kit:knowledge/confluence` | Confluence pages by id, one markdown file each. | The secret `CONFLUENCE_API_TOKEN`, curl and jq |

`kit:knowledge/review-learnings` is not a sync: see Learnings below.

Each kit writes into its own folder in the knowledge (`folder`, for
example `wiki`) and reports how many files it has. `files` and
`github-wiki` replace what their folder had.

## Learnings

An agent that reads the knowledge may add `learnings` to its step report:
a list of short notes about the project that would help the next agent.
Its report instructions say so in one sentence, and the field is
optional, so an agent with nothing to say reports as before.

The computer that ran the step keeps them in
`learnings/proposed/<run id>.md`. They wait for you there: the index does
not list them, and no agent reads them.

The `review-learnings` starter flow calls `kit:knowledge/review-learnings`.
It opens a Gate with the proposals. **Keep** moves them to
`learnings/accepted/`, where the index lists them and agents read them.
**Delete** removes them. A proposal that comes in while the Gate waits
stays for the next review. The Knowledge page says how many wait, with a
button that runs the review.

## Search

Each computer keeps a keyword index of its knowledge: the text files
(`.md`, `.markdown`, `.mdx`, `.txt`, `.rst`), not `INDEX.md`, hidden files
or the learnings that wait. The Knowledge page has a search field, and
`nightshift mcp` has two tools for an agent:

- `search_knowledge` (`query`, `limit`): the best files first, each with
  its path, title and an excerpt with the words found in bold.
- `read_knowledge` (`path`): one file, at most its first 100 KB.

Every word must match. When no file has them all, files with some of them
come back. A word in the title counts most, then one in the path, then one
in the text. `"a phrase"` keeps words together, `deploy*` matches a word
that starts with it, and so does the last word you type. Words match
their other forms: `deploying` finds `deploy`.

The index is in `<data folder>/knowledge/.search.sqlite` (SQLite FTS5,
BM25 ranking). It is the computer's own: it never syncs, and you can
delete it. Before each search, Night Shift reads again only the files
whose size or time of change differ, and drops the ones that went. So it
stays right whoever changes the folder. For 2 000 files the first search
takes about half a second, and a later one about 50 ms. It reads the first
1 MB of a file.

An agent that gets the folder keeps reading `INDEX.md` and grepping it. A
node that wants search adds the `nightshift` MCP server as a connection.

## Size

The Knowledge page warns past 2 000 files. Nothing loads the folder into a
prompt, but an agent finds less in that much text. Sync only what your
agents need.

## Known gaps (phase 1)

- The Knowledge page shows the folder of the computer that serves the
  page. A project that runs on another Device has its knowledge there.
- Search is by keyword, not by meaning: a word that is not in a file
  does not find it.
