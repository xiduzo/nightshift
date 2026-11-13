# Knowledge

Knowledge is the files that your agents read besides the project files: notes, web pages, a wiki, files of a git repository, Jira work items, Confluence pages. Night Shift keeps them per project, outside the project folder. Every computer of the project's Space works on the same files.

## What an agent gets

- Every Command step, and every command that an agent runs, gets the knowledge folder as `$NS_KNOWLEDGE`.
- An Agent node can list the folders of the knowledge that it gets. Then the step gets only those.
- An agent searches the knowledge with two tools: `search_knowledge` and `read_knowledge`. Grok Build and pi do not get these tools.

## Sources

**Add source** on the Knowledge page fills the knowledge. Choose the kind, and fill in its fields. Night Shift saves a flow that runs the kit, and gives each source its own folder. With **Keep it up to date**, Night Shift adds a schedule for it. **Sync now** runs it at once.

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

**Git repository** copies only the folders or files you choose, for example the markdown of a documentation site. In **Only these paths**, write one pattern per line:

```
docs/standaard/**/*.md
!docs/standaard/archief/**
```

A line that starts with `!` leaves those paths out. Each sync takes the newest version, and a file that no longer matches leaves the knowledge.

**Project files** copies from the project's own folder, so only a project with a folder offers it.

**Web pages** can copy a whole site from one address. Turn on **Follow links**. Night Shift then also copies the pages that your pages link to:

- **Only addresses that start with**: the part of the site to copy, one address per line. Empty: the folder of each page, for example `https://example.com/docs/`.
- **Most pages**: at most 500.
- **Links away**: how many links away from your pages to go.

Night Shift uses the list of pages that the site publishes when it has one. It skips images, files and PDFs, and the pages that the site asks readers to skip. It reads one page at a time, so 100 pages take about 15 minutes. A page that left the site leaves the knowledge on the next full sync. When a sync stops at the page limit, it removes nothing.

Any flow that writes markdown into `$NS_KNOWLEDGE` is a source too.

## Learnings

An agent can propose what it learned about the project: short notes that help the next agent. A proposed note waits for you. No agent reads it until you keep it.

Night Shift also looks back at a run when it ends. It does this only when the run needed a fix or your answer:

- A step failed, and a later try worked.
- The run before failed at a step, and this run passed it.
- The run failed at the same step as the run before.
- A step asked you, or an agent could not go on without you.
- You answered a Gate and wrote why.

Then the **Learner** proposes at most five notes. A note from a run shows "Night Shift learned this from a run", with a link to the run. It waits for you like the other notes. Other runs cost nothing. The Learner never keeps a note itself.

To stop these notes for a project, open **Review** and turn off **Learn from runs**. This holds for every computer of the Space. To choose who answers for the Learner, see [Agents and profiles](Agents-and-profiles.md).

The **Review** page shows each note, with the notes close to it. Keep it, delete it, or put it off. The keys are K, D, and S. The `review-learnings` starter flow asks you in a Gate in place of the page.

## Search

The Knowledge page has a search field. Search finds a file by its words. When Ollama runs, search also finds a section by its meaning, so a question in other words finds the answer too.

To search by meaning on your own computer:

1. Install Ollama from https://ollama.com.
2. Open **Settings**, then **Night Shift's agents**.
3. In the **Search** table, click **Download** (639 MB).

The Docker image has Ollama inside. A Host starts it by itself, and downloads the model at its first start. The Knowledge page tells you when search by meaning stopped.

## The Map

The Map shows the files, the topics that they share, the links between them, and the files close in meaning. It also shows the questions that found them, and the learnings that name their topics. No model makes the Map, and agents do not get it.

## More

[docs/knowledge.md](https://github.com/xiduzo/nightshift/blob/main/docs/knowledge.md) tells how the knowledge syncs between computers, how search works, and how it is measured.
