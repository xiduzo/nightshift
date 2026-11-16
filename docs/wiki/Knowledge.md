# Knowledge

Knowledge is what your agents read besides the project files: notes, web pages, documentation, work items. Use it to give an agent the background that it needs, such as your style guide, a product manual, or the reports of earlier runs.

Each project has its own knowledge. Night Shift keeps it outside the project folder. Every computer of the project's Space sees the same files.

## Add a source

A source fills the knowledge from one place, such as a website or a folder of notes. For example, copy the documentation of a tool that your agents use:

1. Open the project, then **Knowledge**.
2. Choose **Add source**.
3. Choose **Web pages**.
4. In **Pages**, type the address, for example `https://example.com/docs/`.
5. To copy the pages that it links to as well, turn on **Follow links**.
6. To copy the pages again each day, turn on **Keep it up to date**, and choose a time.
7. Turn on **Sync now**, and choose **Add source**.

Night Shift copies the pages as Markdown files, into a folder of their own. Open **Files** on the Knowledge page to see them.

## Kinds of sources

| Source | Copies | Needs |
| --- | --- | --- |
| **Web pages** | Web pages, and with **Follow links** a whole part of a site. | Nothing. |
| **Folder on this computer** | A folder of notes outside the project. | Nothing. |
| **Project files** | Files of the project, also files that git ignores, such as private notes. | A project with a folder. |
| **Git repository** | The folders or files that you choose of a repository. | git signed in, for a private repository. |
| **GitHub wiki** | The wiki of a GitHub repository. | git signed in to GitHub, for a private wiki. |
| **Jira** | Jira work items, one file each. | A CLI tool for the Atlassian CLI, signed in, and `jq`. |
| **Confluence** | Confluence pages, one file each. | An Atlassian API token as the secret `CONFLUENCE_API_TOKEN`, and `jq`. |

Each sync replaces what the folder of the source had. So do not edit the copied files by hand. Change the source instead.

### Web pages

With **Follow links** on, three more fields set how much to copy:

- **Only addresses that start with**: the part of the site to copy, one address per line. When it is empty, Night Shift stays in the folder of each page, for example `https://example.com/docs/`.
- **Most pages**: at most 500.
- **Links away**: how far to go from your pages.

Night Shift reads one page at a time, so 100 pages take about 15 minutes. It skips images, PDFs, and the pages that the site asks readers to skip. A page that cannot be read does not stop the others. A page that left the site leaves the knowledge at the next full sync. When a sync stops at **Most pages**, it removes nothing.

### Git repository

In **Only these paths**, write one pattern per line. A line that starts with `!` leaves those paths out. For example, the Markdown of a documentation site without its archive:

```text
docs/**/*.md
!docs/archive/**
```

Each sync takes the newest version. A file that no longer matches leaves the knowledge.

## What an agent gets

- An agent searches the knowledge itself, and reads what it finds. You do not have to name the files in the prompt.
- An Agent node can list folders of the knowledge. Then that step gets only those folders.
- Grok Build and pi cannot search the knowledge. They still read the project files.

For scripts: every Command step, and every command that an agent runs, finds the knowledge folder in `$NS_KNOWLEDGE`. A flow that writes Markdown files there is a source too. The starter flow `scout-and-pick` does this with its reports.

## Learnings

An agent can propose a short note about the project that helps the next agent, such as "The client writes prices in euros". A proposed note waits for you. No agent reads it until you keep it.

To check the proposed notes:

1. Open **Knowledge**, then **Review**.
2. For each note, choose to keep it, delete it, or decide later. The keys are K, D, and S.

The starter flow `review-learnings` asks you the same in a Gate. Schedule it to check the notes once a week.

### Notes from runs

Night Shift also looks back at a run that needed a fix or your answer. For example, a step failed and a later try worked, or you answered a Gate and wrote why. The **Learner** then proposes at most five notes. Each note links to its run. A run that went well costs nothing.

To stop these notes for a project, open **Review** and turn off **Learn from runs**. This holds for every computer of the Space. To choose which agent or model writes them, see [Night Shift's agents](Agents-and-profiles.md#night-shifts-agents).

## Search

The Knowledge page has a search field. Search finds a file by its words. When Ollama runs, search also finds a section by its meaning, so a question in other words finds the answer too. Your agents use the same search.

To search by meaning on your own computer:

1. Install Ollama from https://ollama.com.
2. Open **Settings**, then **Night Shift's agents**.
3. In the **Search** table, choose **Download** (639 MB).

The Docker image has Ollama inside. A Host starts it, and downloads the model at its first start. The Knowledge page tells you when search by meaning stops.

## The Map

The Map shows the files, the topics that they share, and the links between them. It also shows which files are close in meaning, which questions found them, and which learnings name their topics. Use it to see what your agents know, and where a gap is. Agents do not see the Map.

## Advanced

[docs/knowledge.md](https://github.com/xiduzo/nightshift/blob/main/docs/knowledge.md) tells how the knowledge syncs between computers, how search works, and how it is measured.

Each source is a flow that runs a kit. You can run the same kits from your own flows:

<!-- generated:knowledge-kits: bun run docs:reference writes this table from the code. Do not edit it here. -->
| Kit | Family | Does | Inputs |
| --- | --- | --- | --- |
| `kit:knowledge/confluence` | Do | Copies Confluence pages into the project's knowledge as markdown, one file each. Save an Atlassian API token as the secret CONFLUENCE_API_TOKEN. Needs jq. | `site`, `email`, `pages`, `folder` |
| `kit:knowledge/files` | Do | Copies files of the project into its knowledge, also files that git ignores, such as private notes. It replaces what the folder had. | `from`, `folder` |
| `kit:knowledge/folder` | Do | Copies a folder of this computer into the project's knowledge, such as notes outside the project. It replaces what the folder had. | `path`, `patterns`, `folder` |
| `kit:knowledge/git` | Do | Copies the folders or files you choose of a git repository into the project's knowledge. Each later sync takes the newest version. A private repository needs git signed in. | `repo`, `branch`, `paths`, `folder` |
| `kit:knowledge/github-wiki` | Do | Copies the wiki of a GitHub repository into the project's knowledge, and takes the newest pages on each later sync. A private wiki needs git signed in to GitHub. | `repo`, `folder` |
| `kit:knowledge/jira` | Do | Copies Jira work items into the project's knowledge as markdown, one file each. Needs a CLI tool that runs the Atlassian CLI signed in, and jq. | `keys`, `tool`, `folder` |
| `kit:knowledge/review-learnings` | Decide | Shows what agents proposed to learn about the project, and asks you to keep or delete it. Agents read what you keep. | none |
| `kit:knowledge/web` | Do | Copies web pages into the project's knowledge as markdown. It needs no account. Each page gets a file named after its address. A page that cannot be read does not stop the others. With Follow links, it also copies the pages that they link to. | `urls`, `follow`, `scope`, `limit`, `depth`, `folder` |
<!-- /generated:knowledge-kits -->
