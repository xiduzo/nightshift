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
at the last reconcile. It is the base of the merge. `INDEX.md`, hidden files
and the files a sync kit still writes (names that end in `.part`) never sync.
A file larger than 10 MB stays on the computer that has it. The others list
it, but do not fetch it.

A file changed when its size or its time of change differ. Then Night Shift
compares its hash. An edit that keeps both size and time is not seen until
one of them changes. The reconcile, `INDEX.md` and the search index share
this rule (`folder-snapshot.ts`). A step's start scans the folder twice: the
reconcile scans it, and after the reconcile one more scan serves `INDEX.md`
and the search index.

The search index has its own record of the files it read, and neither record
replaces the other. If you delete the index, no file comes back and no file
goes. If you delete `.reconciled.json`, the next reconcile is an import. It
loses no file, but a file that another computer removed can come back.

A computer that cannot reach its Host works on its own copy. Content it
cannot copy waits. Night Shift tries again each minute and at the next
reconcile. A file whose content it cannot fetch keeps its old version
until the next reconcile. The step continues.

A Host of an older version does not know the knowledge procedures. Its
first answer tells the computer so, as it tells the run exchange. Then the
computer works on its own copy and asks again after an hour. The Knowledge
page says that the Host needs an update.

The first start after the upgrade reconciles each folder a computer has,
and so publishes its files. When two computers have one path, the later
change wins.

Once a day, the computer that keeps a Space (its Host, or the one computer
of a Space without a Host) removes content that no knowledge document of
the Space names any more. Content stays for 7 days after a computer last
copied it, because its entry can reach the Host later than the content.

When a project moves to another Space, its knowledge moves with it: its
content goes to the new Space's Host. When a computer joins a Space that
has the same project under another id, the folder moves to that id. Its
files go into that project's document, and the later change wins. The
old document and its search index go.

### Who may read and change it

Every Member of the Space can read the knowledge, on any computer and on
the Host. A computer publishes its changes when its Member has a role that
may start runs. A browser never writes the folder. A person changes knowledge
through flows (the syncs, the review of learnings), through Keep and Delete on
the Review page, and by marking a question or a word that is not a topic. These
need the same role. In a shared Space, the Knowledge page says
that every Member can read what you sync there. Before you sync a client's
Jira or Confluence into a shared Space, make sure that each Member may see
it.

### The index

Night Shift writes `INDEX.md` at the top of the folder: one line per file,
with its path, title, first sentence and the day it changed. Under the line
of a markdown file comes a second line with its headings, so an agent that
can only grep still sees how a file is built:

```
- `research/knowledge-vectors.md`: Knowledge vectors. Status: written spike (changed 2026-10-30)
  1 Decision · 2 The pieces · 3 The numbers · 4 The evaluation plan · 5 Risks
```

An agent reads this file first, so its size has limits:

- Only the 100 largest markdown files show headings.
- One file shows at most 12 headings and 300 characters. Then it says how
  many more it has: `… 188 more`.
- It shows the top level under the title, then each deeper level while all
  of that level fits.
- Night Shift reads at most the first 256 KB of a file for its headings.
- PDF and Word files show no headings, so they cost a step's start nothing
  extra.

Night Shift writes it again when an agent gets the folder, if a file is newer
than the index or a file came or went. So a folder that no agent got yet has no
`INDEX.md`. A sync, a Command step and the Knowledge page do not write it. Each
computer writes its own, and it never syncs.

`learnings/` belongs to Night Shift. What agents propose to learn waits in
`learnings/proposed/` until you keep it in `learnings/accepted/`. The
index lists only the accepted ones.

### The Map

The Map page of Knowledge shows the files, the topics they share, the links
between them, the files close in meaning, the questions that found them and the
learnings that name their topics. `packages/engine/src/knowledge/map.ts` draws
it, and `topics.ts` finds the topics.

The Map draws what this computer's search index already holds. It reads the
sections and the stored vectors through the search store. To draw it, Night
Shift does not ask the Host, nor a model, so the page opens when the Host is
down. A test measures this. A file that the Space lists and this computer does
not have yet stands alone on the Map, until a reconcile brings it. The Map is
for people. Agents do not get it, and search does not use it.

No model makes the Map. A Map that a model makes would be a flow that writes a
file ([the research](research/knowledge-graph-extraction.md)). The engine has no
seam for one.

**Topics.** Night Shift counts words, in every language the same way. These rules
lift it above a plain count. Each rule improved the top topics on this
repository's docs or on a Dutch text, or it is not here:

- A plural folds into its singular, when the text has both: "Devices" and
  "Device" are one topic. The rule is in English and Dutch ("modellen", "model").
- Two words that stand together more than a fifth of the time, in two files or
  more, are one topic: "pull request", "MCP server", "wettelijke termijn". A word
  that mostly stands in its phrases gives way to them: no "wettelijke" next to
  "wettelijke termijn". A phrase scores double, or single words fill every place.
- Short words of English and Dutch stop a phrase and are no topics. Everyday
  verbs and words of web pages are no topic alone, but fine in a phrase.

**Not a topic.** A person marks a topic on the Map, and the next word takes its
place. The list is `evals/not-topics.json`. It syncs with the knowledge, as the
question set does, so it follows the Space and not the Device. It holds for the
word in either number. Marking a phrase does not hide its words. If two people
mark a word at the same moment, the later list wins.

**Files close in meaning.** Two files connect when the middle of their section
vectors is at the model's line (`closeAt` in `embedding-model.ts`) or above it,
and each is among the other's three closest. Two files that link do not get this
edge too. The middle of the sections says more than the best pair of sections,
which favours long files.

| Measured on `docs/`, 55 files, 1 415 sections, `qwen3-embedding:0.6b`, 2026-11-04 | Top 40 pairs that share a subject by name |
| --- | --- |
| Best pair of sections | 8 |
| Middle of the sections | 19 |

The line for this model is 0.6. On `docs/`, 382 of the 1 485 pairs of files are
over it, and the mutual rule keeps 38. 25 stay after the pairs that link. The
share with a subject in common by name is flat from 0.6 to 0.85, between 42% and
50%, so the mutual rule does the choosing
and the line is a guard. Files of unrelated subjects stay far below it: 0.14 to
0.36 between a Dutch text and English docs, and between English docs of different
subjects. Four short Dutch files on one subject sit at 0.41 to 0.60, so they get
no edge: the line is measured on longer files, and no Dutch corpus was at hand. A
model that nobody measured has no line, and its Map has no such edges. With no
model, with search by meaning off for the project, or before the first vectors,
the Map stands without them.

**What it costs.** A draw counts on the daemon's one thread. It reads at most
6 MB of text, 60 KB of each file, and at most 4 000 vectors: the first section of
each file, then the second. It compares the first 400 files by path. On a computer
with a load of 50 to 65, the limits took 600 to 1 150 ms for the text, 160 to
390 ms to read the vectors, and 110 to 240 ms to compare. A project the size of
`docs/` draws in 150 to 400 ms on that computer. Past the text limit, the page says
how many files it left out.

So Night Shift keeps the last Map of each project, for the last 8 projects, as
long as what it drew from stays the same: the hash of each file, the vectors there
are, the files the Space lists, what agents asked, the learnings that wait and what
is not a topic. Each draw reads these again, which costs little, and any change
draws again at once. No part of Night Shift has to say that the Map is old. With
1 000 files and a load of 4, a draw took 650 ms and the next one 7 to 22 ms.

## What an agent gets

An Agent step gets the folder when the folder has files. To change that,
set `knowledge` on the Agent node: `true` gives it always, `false` never,
and a list of folders gives only those ([Only some folders](#only-some-folders)).
In the editor, this is the Knowledge section on the Setup tab.

One module holds all of this text: `packages/agents/src/knowledge/brief.ts`.
The snapshot next to its test shows what each harness gets, in each mode. A
test checks the quotes in this file against that module.

The agent gets one line next to its prompt, not the files:

> Project knowledge is in `<folder>`. Read INDEX.md there first, then grep
> the folder for what you need. Do not change the folder.

Where the harness takes Night Shift's own tools, the agent also gets
`search_knowledge` and `read_knowledge` (see [Search](#search)), in the
run's project only, and one more line after its prompt:

> To find something in the project knowledge, call `search_knowledge` with
> a few keywords or a question. It finds sections of files by their words,
> and by their meaning when this computer can. PDF and Word files too.
> Then read a file it gives with `read_knowledge`: give the hit's section,
> page or line to read from there.

| Harness | The folder | The line | Search tools |
| --- | --- | --- | --- |
| Claude Code | `--add-dir` | `--append-system-prompt` | yes, allowed without a prompt; not in plan mode |
| OpenCode | allowed as an outside folder | before the prompt | yes |
| Codex | reads any folder already (`--add-dir` would let it write) | before the prompt | yes |
| ACP agents (Copilot, Gemini, Cursor, custom agents) | read any folder already | before the prompt | yes |
| pi, Grok Build | read any folder already | before the prompt | no: no MCP. They grep the folder |

Some versions of Claude Code also load a `CLAUDE.md` in an `--add-dir`
folder. Only the line works with every version.

### Only some folders

An agent that sees a result steers toward it. To give a step only part of
the knowledge, set `knowledge` to a list of folders (or files) of it:

```json
"knowledge": ["books", "learnings/accepted", "research/papers"]
```

In the editor, choose "Only some folders" in the Knowledge section and
pick the folders.

The step then gets a view, not the folder:

1. Before the step, the reconcile runs as usual. Then the computer copies
   the files of the listed folders into a new folder of the step, outside
   the knowledge folder and outside the worktree. It does not link them,
   so a write to the copy never reaches the knowledge.
2. Night Shift writes an `INDEX.md` in the copy that lists only its files.
3. `$NS_KNOWLEDGE`, the line and the folder to read (`--add-dir`) point at
   the copy. The agent does not get the path of the knowledge folder.
4. `search_knowledge` returns only files in the listed folders, found by
   words and by meaning. `read_knowledge` reads no other file.
5. When the step ends, the computer removes the copy. No reconcile sees it.

The rules:

- A path is relative to the knowledge folder, with `/` between its parts.
  `books` gives `books/` and everything in it, not `bookshelf/`.
- An absolute path, `..`, a hidden part and an empty list are not valid.
  To give no knowledge, use `false`.
- A folder that does not exist yet is valid and gives nothing. The editor
  marks it.
- `learnings/accepted` is a folder like the others: list it to give the
  learnings you kept. The step still gets the learnings field, and what it
  proposes still goes to `learnings/proposed/` of the knowledge.
- The view is a wall for what the agent reads through Night Shift. A
  harness that reads any file on the computer can still find the knowledge
  folder if it looks for it. Keep data that no agent may see out of the
  knowledge.
- The list goes to the computer that runs the step in a field of its own.
  A computer with an older Night Shift gives such a step no knowledge,
  never the whole folder.

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
  (`packages/engine/src/knowledge/sources.ts`) owns every rule of a source:
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

When the last sync of a source failed, the page shows an alert above the
sources. A source whose last sync ended more than 7 days ago shows
**Out of date**.

A folder exists on one computer only. A folder source names the computer
where you added it on its Subflow node (`device`, **Runs on** in the
editor). The Subflow's steps run there, whoever starts the run: the Host
that fires its schedule, **Sync now**, or the Flows page. That computer's
reconcile after the step publishes the files to the Space. An older folder
source without `device` runs on the Host until you save it again from the
computer that has the folder.

Saving a flow needs a role that may save flows. Who may write to the
knowledge stays as above: the computer that runs the sync publishes it.

Kits do the common syncs. Call one from a Subflow node:

| Kit | What it copies | Needs |
| --- | --- | --- |
| `kit:knowledge/files` | Paths or patterns of the project's own folder, one per line: `docs/private`. Files git ignores too, so private docs become knowledge without a commit. | Nothing |
| `kit:knowledge/folder` | A folder anywhere on the computer (`~/notes` or a full path), with optional patterns, one per line: `*.md`. Hidden files stay out. At most 5 000 files. | Nothing. Runs on the computer that has the folder |
| `kit:knowledge/github-wiki` | The wiki of a repository (`owner/name`), or any git address. | git, signed in for a private wiki |
| `kit:knowledge/git` | Some folders or files of any git repository (`owner/name` or any git address), with an optional branch. "Only these paths" takes gitignore-style patterns, one per line: `docs/standaard/**/*.md`, `!docs/standaard/archief/**`. Empty copies the whole repository. The clone is shallow, blobless and sparse, so git fetches only the contents of matching files. | git, signed in for a private repository |
| `kit:knowledge/web` | Web pages as markdown, through `r.jina.ai`. A page that cannot be read keeps its last copy and does not stop the others. The sync fails only when it reads no page. | curl, no account |
| `kit:knowledge/jira` | Jira work items, one markdown file each. | A CLI tool for `acli`, signed in, and jq |
| `kit:knowledge/confluence` | Confluence pages by id, one markdown file each. | The secret `CONFLUENCE_API_TOKEN`, curl and jq |

`kit:knowledge/review-learnings` is not a sync. See Learnings below.

Each sync kit is one declaration in
`packages/flows/src/kits/knowledge/source-kits.ts`. The list of kits, the
Knowledge page and the readiness check all read that list. To add a source,
add one declaration there.

When you add a project, the readiness check names curl or jq when this
computer does not have them, with the command that installs them. Runs
start without them: only the sources that need them fail.

Each kit writes into its own folder in the knowledge (`folder`, for
example `wiki`) and reports how many files it has. `files`, `folder`,
`github-wiki` and `git` replace the old content of their folder.

`kit:knowledge/git` keeps its clone in the folder: the `.git` folder is
hidden, so it never syncs to the Space and stays out of `INDEX.md` and
search. Each sync fetches the newest commit with depth 1, applies the
patterns again with `git sparse-checkout set --no-cone`, and resets to the
commit. A file that no longer matches leaves the folder. Another address
clones anew. Example: the GEMMA Zaken repository
(`VNG-Realisatie/gemma-zaken`) is 243 MB, but `docs/standaard/**/*.md`
copies about 160 files of about 400 KB. Partial clone needs a server that
allows filters. GitHub does. A server that does not sends the whole
commit, and the patterns still pick the files.

## Learnings

An agent that reads the knowledge may add `learnings` to its step report.
That is a list of short notes about the project that help the next agent.
Its report instructions say so in one sentence:

> If you learned something about this project that would help the next
> agent, add it to `learnings`: a list of short notes. Leave it out otherwise.

The field is optional, so an agent with nothing to say reports as before.

The computer that ran the step keeps them in
`learnings/proposed/<run id>.<step id>.md`. Each step has its own file, so
two steps of one run on two computers keep both. Its reconcile after the
step puts them in the Space. They wait for you there. The index does not list them, and
no agent reads them.

The `review-learnings` starter flow calls `kit:knowledge/review-learnings`.
It opens a Gate with the proposed learnings, without the header Night Shift
writes at the top of each file:

- **Keep** moves them to `learnings/accepted/`. There the index lists them
  and agents read them.
- **Delete** removes them.

A proposed learning that arrives while the Gate waits stays for the next
review. The review runs on any computer of the Space. Its reconcile first
fetches the proposed learnings, and then puts what it kept or deleted back in
the Space.

You can also keep or delete proposed learnings on the Review page of Knowledge,
one step at a time. Each decision acts on all notes of that step. The
page sends it after 5 seconds, so you can undo it.

The open screens of the Members read the proposed learnings again each time a
reconcile finds that what waits changed. That covers what a step proposes when
it ends, the Review page, a review by the kit, and each of these on another
computer. One reconcile tells them once, however many files it brings. No
push goes out for this. The Gate of the review sends its own push.

### Close notes

The Review page shows when a note that waits is close in meaning to another
note: one that also waits, or one you kept. It shows the text of the other
note, so you can compare the two. You still keep or delete each step's notes.
Nothing merges, and nothing goes away by itself.

A cosine cannot tell a note that repeats another from a note that disagrees
with it, because both are about one thing. So the page says that the notes are
close. It does not say which of the two it is.

`packages/engine/src/knowledge/close-notes.ts` owns this. The list of what waits
gains `nearTo`: one list per note, in the order of `notes`, with the three
closest at most. Each has the file `id`, the text in `note`, whether it is `kept`,
and the `similarity`. The field is additive. An older phone ignores it, and an
older Host does not send it. The phone does not show it: comparing notes is work
for a computer.

**A page never waits for a model.** The read asks the search index for vectors
that it already has. It does not ask whether the model is ready. A note with no
vector yet is not compared. Its vector comes in the background, one project at a
time, through the same paced embeddings as the sections. When vectors came, the
open screens read again. After a failed embed, the next try waits a minute.

Vectors of notes are in the search index, in their own table, by the hash of the
text. So a note embeds once: not at each draw, not after a restart, and not again
when you keep it. The vectors of notes that went are dropped at the next
preparation. Another model drops them all, as it does the vectors of sections.
Each draw compares again only when a note or a vector changed.

Search by meaning off for the project, no model, or a model with no measured
line: the list has no `nearTo`, and nothing embeds. When the model stops
answering, the vectors that are there still count, as they do on the Map. A
computer compares with the kept notes it has here, the 500 newest files at most.
It does not ask the Host for them.

**The line.** Two notes are close at the model's `closeNotesAt` in
`embedding-model.ts` or above it. The line for `qwen3-embedding:0.6b` is 0.78.

| 191 notes, `qwen3-embedding:0.6b`, 2026-11-05 | Pairs | Least | Middle | Most | At 0.78 or above |
| --- | --- | --- | --- | --- | --- |
| Same thing in other words | 42 | 0.783 | 0.886 | 0.956 | 42 |
| Nearly the same words | 8 | 0.963 | 0.990 | 0.998 | 8 |
| One subject, the facts disagree | 24 | 0.670 | 0.875 | 0.962 | 19 |
| One subject or area, other facts | 50 | 0.395 | 0.624 | 0.767 | 0 |
| Other subjects | 17 911 | 0.092 | 0.325 | 0.762 | 0 |

Read this table with care:

- One author wrote these notes and their labels. They have the shape of real
  notes, but they come from no real project. No real notes were measured.
- The gap is thin: 0.767 to 0.783. A related pair can pass the line in real use.
  That costs one extra comparison for a person, and nothing is lost.
- 5 of 24 pairs that disagree stay under the line, for example "needs approval
  from two people" and "anyone can deploy with no approval". Absence of a close
  note does not mean that a note agrees with the others.
- Close does not rank what repeats first. "Cut on Tuesdays" is 0.953 from "cut on
  Fridays", and 0.796 from "every Tuesday a new branch gets created".

To measure again or try another model, run `close-notes.live.test.ts` with
`OLLAMA_LIVE_MODEL` set. The notes are in `testing/fixtures/close-notes.ts`.

### The Review page

The Review page shows what the engine decides waits (`knowledge.review`,
`knowledge/review.ts`): a source that needs a look, a step's learnings, a
question that found nothing, and the files no run used. The engine sets the
order and the id of each task. The screen only remembers what a person put off
or dismissed in this browser. The phone shows only the learnings, of every
project: it is for acting at night, and the rest needs a computer.

Both apps send Keep and Delete through `useSettleLearnings` of
`@nightshift/client`, which also says what to read again. They differ on purpose
at one point. The web app gives 5 seconds to undo. The phone sends at the tap,
so Delete asks first. On both, Keep waits for notes you can read, and a role
that may not decide does not get the buttons.

The Learnings module (`packages/engine/src/knowledge/learnings.ts`) owns this
protocol. The text of a file and the rule for its name are in
`packages/flows/src/kits/knowledge/` (`learning-file.ts`, `layout.ts`), because
agent reports, the web app and the kit need them too. The kit stays shell, so
that it needs no Night Shift command on the `PATH` of a step. Its Keep and Delete
are the second form of `settle`. `learnings-kit.test.ts` runs both forms
over the same folders and asks for the same result.

### Proposed learnings from a Command

A Command can propose learnings too. It writes a file to
`$NS_KNOWLEDGE/learnings/proposed/`. The rules:

- The review Gate shows every proposed learning directly in that folder. It
  shows all of the text, because Keep adds all of it to what agents read. It leaves
  out only blank lines and the header Night Shift writes. It does not look in
  subfolders.
- Write one note per `- ` line. The Knowledge page shows and counts the notes
  by these lines. It does not show other text. Use the Gate to read it.
- Night Shift names its own files `<run id>.<step id>.md`. A Command gets
  no run id or step id, so it gives the file a name of its own, for
  example `<flow>.<date>.md`.
- Use only letters, digits, `-` and `_` in each part of the name, and at
  most two parts before `.md`. Start each part with a letter or a digit. Only
  a name of that form is a proposed learning, for the Gate, for Keep and Delete, and for
  the Knowledge page and its count. A file with any other name stays in the
  folder, and nothing shows it.

For example:

```sh
echo "- The nightly sweep needs 40 minutes." \
  >> "$NS_KNOWLEDGE/learnings/proposed/{{run.flow}}.$(date +%Y-%m-%d).md"
```

## Search

Each computer keeps a search index of its knowledge: the text files
(`.md`, `.markdown`, `.mdx`, `.txt`, `.rst`) and the text of PDF and Word
files (`.pdf`, `.docx`), not `INDEX.md`, hidden files, the files a sync
kit still writes or the learnings that wait. A PDF or Word file over 10 MB is found by its path only. The
Knowledge page has a search field. Every Agent step that gets the folder
has two tools (where its harness takes them), and so does `nightshift mcp`:

- `search_knowledge` (`query`, `limit`): the best files first, each with
  its path, title, the section it found (heading, line, page of a PDF) and
  an excerpt with the words found in bold.
- `read_knowledge` (`path`, and `section`, `page` or `line` from a hit):
  one file, at most 100 KB: from its start, or from the spot the hit names.
  A section starts at its heading, else at the first line with its words.
  A line counts in the page given. The answer says where the text starts.
  For a PDF or Word file, its text.

`nightshift mcp` also lists the files as MCP resources (spec 2025-11-25):
`nightshift://knowledge/<project id>/<path>`, for the project it works in,
else for every project. A resource read is the same read as
`read_knowledge`.

A step and `nightshift mcp` read a file in the same way. Night Shift
reads the copy on this computer first. When this computer does not have
the file yet, Night Shift gets its content from the Space by its hash.
Both give the text of a PDF or Word file. Neither gives the learnings
that wait for a person.

Two small LangChain document loaders in `documents.ts` read the text:
`PdfLoader` on `unpdf` for a PDF and `DocxLoader` on `mammoth` for a Word
file. Neither library has native parts, so both work in the `nightshift`
binary too. A PDF of scanned pages has no text to find. `INDEX.md` lists a PDF or Word file
with the title the PDF gives, else the first line of its text, and its
first sentence.

Night Shift parses one such file at a time, because a folder of PDFs must not
hold dozens in memory. A read of one file goes before all that the search index
and `INDEX.md` queued, so it waits only for the parse that runs.

Night Shift cuts each file into sections of about 1 200 characters, at
its headings first (`@langchain/textsplitters`). A PDF is cut page by
page. A hit is a file at its best section, so the result says where to
look.

A section knows its heading path: the headings above it, one per level.
The embedding model reads the file's title, that path and the section:
`Knowledge vectors › 4 The evaluation plan`, then the text of 4.3. A heading
that the text already starts with does not come twice. So a section called
"Limits" says whose limits.

### By words

Every word must match in one section. When no section has them all, the
search returns sections with some of them. A word in the title counts
most, then one in the path, then one in a heading, then one in the text.
`"a phrase"` keeps words together. `deploy*` matches a word that starts
with it, and so does the last word you type. Words match their other
forms: `deploying` finds `deploy`.

### By meaning

Search also finds a section by its meaning when Ollama answers and has
the embedding model. Then a question in other words finds the answer too.
The default model, `qwen3-embedding:0.6b`, reads Dutch as well as English.

The Night Shift image (`deploy/Dockerfile`) has Ollama inside. A Host starts
it by itself and downloads the model into its data folder on its first
start. On your own computer:

1. Install Ollama from https://ollama.com.
2. Open Settings, then Night Shift's agents. In the Search table, click
   Download, or run
   `ollama pull qwen3-embedding:0.6b` (639 MB).

The Night Shift's agents page of Settings has a Search table, for the
owner of the computer only. Its row holds:

- **Search by meaning.** `auto` (the default): a Host starts Ollama
  itself, and another computer uses the Ollama that runs on it. `on`:
  Night Shift starts Ollama on this computer too. `off`: search finds by
  words only. The environment variable is `NIGHTSHIFT_OLLAMA`.
- **Model.** A model that Ollama has, one of a short list, or any other
  name. A model that Ollama does not have gets a Download button with its
  progress. A new model builds the vectors again. The environment
  variable is `NIGHTSHIFT_EMBEDDING_MODEL`. Only `qwen3-embedding:0.6b`
  was measured on these docs and has a floor (below). The other models of
  the list work, with no floor. `embedding-model.ts` in
  `packages/engine/src/knowledge` has one record per measured model: its
  name, query instruction, floor, line for close files and measurement. A trial
  is one record and one floor run. Two models are watched, with no record
  until a measurement exists: `harrier-oss-v1-0.6b` and
  `embeddinggemma-2:270m` for a Host with only a CPU.
- **Ollama address.** Empty: the Ollama on this computer. With another
  address, your knowledge text goes to that computer to be embedded. The
  environment variable is `OLLAMA_HOST`, as Ollama's own CLI reads it.
  Decision nodes on Ollama use the same address.
- **Headers.** For an Ollama behind a proxy: a value is a `${NAME}`
  reference to a secret, as in the monitoring headers. Session output and
  the log never show their values.

A saved setting wins over its environment variable. The address decides
where Ollama is, in this order: the setting, `OLLAMA_HOST`, then
`http://127.0.0.1:11434`.

Night Shift starts `ollama serve` as its own child only when all of these
are true: search by meaning is not `off`, no address is set, the computer
is a Host or its owner chose `on`, an `ollama` program is on `PATH`, and
nothing answers at `127.0.0.1:11434`. It starts Ollama again when it stops
(after 1 s, then up to 60 s), and stops it when Night Shift stops. Its
models go to `<data folder>/ollama`. Its log lines go to Night Shift's log
with an `[ollama]` prefix, errors only. On a person's own computer it
starts nothing unless the owner chooses `on`: that computer has its own
way to run Ollama.

The Knowledge page says whether search by meaning is on, which Ollama it
uses ("on this computer" or the host name), how far a download or the
first preparation is, when Ollama does not answer, and when a preparation
stopped.

After each change to the folder, Night Shift embeds the new and changed
sections in the background (`@langchain/ollama`, `num_ctx` 2048, so the
model takes about 1 GB of memory). A search never waits for it. It uses
the vectors there are and finds the rest by words. On an M4 Max the first
preparation of 1 100 sections takes about one minute. Later ones embed
only the sections that changed. A section that moves in its file keeps its
vector: the section's id comes from its path, the file's title, its heading path
and its text.

A project prepares only when someone looks at it: a search, or the Knowledge
page. One project prepares at a time. A preparation that fails keeps what it
embedded. The next look at least one minute later tries again, and embeds
only the rest. Each project has one state in `vector-preparation.ts`: `idle`,
`queued`, `preparing`, `failed` or `ready`.

On a CPU it is much slower. In the Night Shift image under Docker Desktop
on an M4 Max (16 vCPUs), Ollama embeds about 0.25 sections per second with
`qwen3-embedding:0.6b`, so 1 156 sections take about 77 minutes. Ollama
then uses all 16 vCPUs. With 10 threads (`num_thread`) the same sections
embed at about 2.5 per second, ten times as fast. `nomic-embed-text` is no
faster there. The container takes about 1.2 GB while it embeds, 380 MB
when it is idle. A preparation sends Ollama about 1.5 s of work at a time,
and a query goes first, so a search finds by meaning during a long
preparation too. A search waits up to 15 s for its query's vector.

The search fuses the two lists by reciprocal rank (each list adds
1 / (60 + rank) to a file). A file only the meaning found must pass the
model's floor: a cosine similarity of 0.50 for `qwen3-embedding:0.6b`. So a
query that nothing answers finds nothing, not the 20 nearest files. A model
without a record in `embedding-model.ts` has none. How the floor was chosen:
[knowledge-vectors.md](research/knowledge-vectors.md) §3.4. Without
Ollama, search finds by words only, and nothing else changes. On this repository's `docs/` (26 questions),
search by words found 18 to 20 answers in the top 5, search by words and
meaning 21 to 22, and search by meaning alone 23.

### The index

The index is in `<data folder>/knowledge/.search.sqlite`: SQLite FTS5 with
BM25 ranking for the words, and float32 vectors scanned in full for the
meaning. It belongs to the computer. It never syncs, and you can delete
it. Before each search, Night Shift reads again only the files whose size
or time of change differ, and splits again only those whose content hash
changed. It drops the removed ones. Thus the index stays correct, whoever
changes the folder. For 2 000 files the first search takes about half a
second, and a later one about 20 ms. It reads the first 1 MB of a file.
A new embedding model builds the vectors again. So does a new version of the
index (`SCHEMA_VERSION` in `search-store.ts`, the one module that knows its
tables).

An agent that gets the folder can still read `INDEX.md` and grep the
folder. In `nightshift mcp` the tools take a `project` too. In a step they
work in the run's project only.

## Measure the search

Every `search_knowledge` and `read_knowledge` call of an agent is an
event: `KnowledgeSearched` (the query, and each file it returned with its
section and how it was found) and `KnowledgeRead` (the path, and the spot
it read from). An Agent step logs them on its step. `nightshift mcp` logs
them with no run. The search box of the Knowledge page logs nothing. The
run's metrics count them, and the OpenTelemetry export puts
`nightshift.knowledge.searches` and `nightshift.knowledge.reads` on the
step's span.

From these events:

- **Sources.** The step console shows the knowledge files an agent used:
  the files it read, then the top 3 hits of its searches that it did not
  read. The agent does nothing extra for it.
- **Questions agents asked.** The Knowledge page lists recent questions,
  each with what it found. Mark the file that answers a question. Marked
  questions are the project's question set: `evals/questions.json` in the
  knowledge. It syncs like the learnings. `evals/` is Night Shift's own, and it
  also holds the words that are not topics on the Map: no
  index, search, read or file list shows it.
- **Test search.** With one marked question or more, the page tests the
  set against search by words, by meaning, and both. It shows how many it
  found in the first 5 results, and the position of each question's first
  right file. When a question has several right files, the page also shows
  how many questions have all of them in the first 5. From 20 marked
  questions, it offers to turn search by meaning off for the project when
  both do not beat words by 10 points. The API also returns nDCG at 10 for
  each way to search, for a person who compares two models. Only the first
  number decides. The thresholds are `EVALUATION` in
  `packages/engine/src/knowledge/evaluate.ts`. The setting is the
  project's, in the knowledge document, so every computer of the Space
  follows it. Off, search finds by words only and prepares no vectors.
- **Use.** The file list shows how often agents found and read each file
  in the last 90 days. It marks the files that no run used in 30 days, once
  runs use the knowledge at all. Those are files you may stop syncing.

On this repository's `docs/` with the 26 questions of the vectors spike
(2026-10-31, with the floor): words found 20 in the top 5, meaning 23,
both 22. That is 7.7 points, so the page would offer to turn meaning off.
With the agents' keyword forms: words 18, meaning 18, both 20.

The heading path was measured the same way on 2026-11-04: this repository's
`docs/`, 55 files, 1 413 sections, 30 new questions by file and 16 by
section, `qwen3-embedding:0.6b` on the M4 Max. Few questions, so one or two
of a difference can be chance.

| What the model reads | Both, by file: top 5, MRR | Meaning, by file: top 5, MRR | Right section in top 3 of 16 | Queries with no answer above 0.50 |
| --- | --- | --- | --- | --- |
| Title, text | 22 of 30, 0.577 | 25 of 30, 0.555 | 6 | 1 of 6 |
| Title, every heading, text | 22 of 30, 0.546 | 23 of 30, 0.512 | 7 | 0 of 6 |
| Title, headings the text does not say, text (this one) | 22 of 30, 0.572 | 23 of 30, 0.542 | 8 | 0 of 6 |

So the path does not find more files. It finds the right section more often,
which is where a hit sends the agent. By meaning alone it loses two questions.
On a made-up runbook with the same three headings under 8 services (24
questions, built to need the path), the right section came first for 0 of 24
without the path and for 19 of 24 with it, and in the top 3 for all 24. The
floor still holds: with this path, the lowest right file in a top 5 is at
0.528, and the highest query with no answer just stays under 0.50.

## Size

The Knowledge page warns above 2 000 files. Nothing loads the folder into
a prompt, but an agent finds less in that much text. Sync only what your
agents need.

### How the knowledge document grows

The knowledge document never forgets. Each change of a path adds a new
entry and leaves a deleted one behind (ADR 4, a Yjs map). Reconcile writes
only a real change, so the growth follows how many files change, not how
often a computer syncs.

A normal wiki changes tens of pages a night. That is harmless for years. A
source that replaces its whole folder each night is the case to watch.
Night Shift measured these numbers on one real Yjs map, in Bun 1.3.10
on an Apple Silicon laptop, with 2 000 paths replaced each night.

| After | Deleted entries | Kept state | Load | Memory the load adds |
| ---------- | --------------- | ---------- | ------ | ------------------- |
| 1 night | 0 | 0.42 MB | 12 ms | 19 MB |
| 30 nights | 58 000 | 0.98 MB | 42 ms | 66 MB |
| 90 nights | 178 000 | 2.0 MB | 90 ms | 124 MB |
| 180 nights | 358 000 | 3.98 MB | 148 ms | 216 MB |
| 365 nights | 728 000 | 7.68 MB | 0.3 to 0.5 s | 410 MB |

The last column is the growth of the resident memory of the process. After
a year, the JavaScript heap of the loaded document is about 185 MB.

- One deleted entry takes about 10 bytes in the kept state. One live entry
  takes about 210 bytes.
- After a year, each change encodes the full state in 65 to 100 ms and writes
  it to SQLite in 28 ms. Memory hurts first. The disk does not.
- A computer that restarts each night is a new Yjs client each night. That
  does not make the document larger: 6.87 MB after a year.
- A copy of only the live entries takes 0.42 MB and loads in 4 ms.

Measure again when Yjs or Bun changes much.

**The measure.** Once a day each computer sends the size of each knowledge
document it keeps, as the anonymous usage event
`nightshift.knowledge.document_measured`: a hash of the project id and the
size in whole kilobytes. It sends no name and no path. The size comes from
SQLite without reading the state, so a heavy document is not loaded for it.
The usage switches stop this event like any other.

**When to compact.** Compact a document when both of these are true:

- Its size is above 5 MB. At the churn above, that is after about 7 months,
  when the load adds about 270 MB of memory.
- Its live entries take less than half of that size. Multiply the number of
  files on the Knowledge page by 210 bytes.

A document that is large because it lists many files gains nothing.

**How to compact.** Compaction is a procedure. No code does it yet (ADR 4
stays, and there is no second CRDT).

1. Release a version of Night Shift that reads a generation for each
   project from the Space document. No generation means the name
   `knowledge:<project id>`. Generation 2 means `knowledge:<project id>:2`.
   The access rules and `documentKind` must accept the new name.
2. Deploy the version to the Host. Update every computer of the Space. A
   computer on an older version keeps writing to the old document, and the
   Space loses those changes.
3. Stop the schedules of the project. Wait until no run of the project is
   open.
4. Open the Knowledge page on each computer, so that each reconciles.
5. On the Host, create `knowledge:<project id>:2`. Copy each entry of `files`
   and each value of `settings` with the same values. Do not copy the
   history.
6. Set the generation of the project to 2 in the Space document. Each
   computer opens the new document at its next reconcile.
7. Start the schedules again.
8. When every computer has reconciled, remove the old document on each
   Replica.

The content stays in the archive, because the hashes do not change. A
computer that reconciles before its new document synced publishes its folder
again. The later change wins, so it loses nothing. Until step 8, the
collection of old content must read both documents.

## The module

`createKnowledge` in `packages/engine/src/knowledge` is the one door to all
of the above. It builds the document view, the search and the reconcile
inside, and returns one interface (`Knowledge`). A step's Device, the API
and the daemon use only that interface. The API checks who asks and carries
the answer.

The daemon makes one `Knowledge` per start. `connect` is its one late
binding, because the devices runtime is made after it. The timers run from
`connect` on: every folder after 15 seconds, the retries each minute, the
collection of old content each day, and the size of each knowledge document
each day. `close` ends them.

A `bun --hot` reload replaces the whole `Knowledge`. What is on disk stays,
and so do the locks of the folders: a step that started before the reload
still holds its folder, and the new `Knowledge` leaves that folder alone. `close` stops the timers and the preparation of vectors, and closes
the index file. The next search opens the file again. Sections that did not
change are not embedded again. A session that outlives the reload still
searches, on its own connection to the index, and prepares nothing.

## What the page waits for

The frame of the Knowledge page draws when `knowledge.get` answers. A Host that
does not answer can cost that read at most 2 seconds each for two things:

1. The reconcile before the list (`pageWaitMs`). It stays, because it puts your
   own changes to the folder in the list. It goes on after the wait.
2. The names of other computers. Night Shift asks the Host only when a source
   names another computer. Too late or not at all: the source says "another
   computer" until the next read.

The count of the notes that wait never asks the Host. A proposed learning whose
content is not here counts as one note. `knowledge.review` and
`knowledge.learnings` ask the Host for such content, because they show the
notes. They stop asking in that read once the Host fails. Their card has its
own loader, so the frame does not wait for them. The Questions card holds the
folder for its reconcile (`knowledge.questions`), and the Review page no longer
reads it.

## Known gaps (phase 1)

- Only the computer that keeps a Space removes content that no entry names. The
  copy in another computer's archive stays. Retention is undecided, as it is for
  run history.
- A run does not record which version of the knowledge it read.
- The Review page shows only the `- ` lines of a proposed learning, and Keep
  adds the whole file. A Command can write other text there. The Gate shows it.
- A screen connected to a computer hears of another computer's change at the
  next reconcile there, or when a run changes.
- Close notes do not say whether two notes repeat or disagree. A model could
  say which (`docs/research/knowledge-graph-extraction.md`). The engine has no
  model for this.
- The evaluation runs from the page only. `kit:knowledge/evaluate`, so a
  schedule can repeat it, waits for a way for a Command step to call Night
  Shift.
- Search by meaning needs Ollama on each computer, or an address of an
  Ollama elsewhere. Each computer embeds its own copy of the knowledge.
- `knowledgeGet` and `knowledgePut` remain on the Device's protocol beside the
  archive's own procedures. They go at the next version of the contract, when
  content becomes a kind of archive reference.
