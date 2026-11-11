# Knowledge

Knowledge is the files that your agents read besides the project files: notes, web pages, a wiki, Jira work items, Confluence pages. Night Shift keeps them per project, outside the project folder. Every computer of the project's Space works on the same files.

## What an agent gets

- Every Command step, and every command that an agent runs, gets the knowledge folder as `$NS_KNOWLEDGE`.
- An Agent node can list the folders of the knowledge that it gets. Then the step gets only those.
- An agent searches the knowledge with two tools: `search_knowledge` and `read_knowledge`. Grok Build and pi do not get these tools.

## Sources

**Add source** on the Knowledge page fills the knowledge. Choose the kind, and fill in its fields. Night Shift saves a flow that runs the kit, and gives each source its own folder. With **Keep it up to date**, Night Shift adds a schedule for it. **Sync now** runs it at once.

<!-- generated:knowledge-kits: bun run docs:reference writes this table from the code. Do not edit it here. -->
| Kit | Does | Inputs |
| --- | --- | --- |
| `kit:knowledge/confluence` | Copies Confluence pages into the project's knowledge as markdown, one file each. Save an Atlassian API token as the secret CONFLUENCE_API_TOKEN. Needs jq. | `site`, `email`, `pages`, `folder` |
| `kit:knowledge/files` | Copies files of the project into its knowledge, also files that git ignores, such as private notes. It replaces what the folder had. | `from`, `folder` |
| `kit:knowledge/folder` | Copies a folder of this computer into the project's knowledge, such as notes outside the project. It replaces what the folder had. | `path`, `patterns`, `folder` |
| `kit:knowledge/github-wiki` | Copies the wiki of a GitHub repository into the project's knowledge, and takes the newest pages on each later sync. A private wiki needs git signed in to GitHub. | `repo`, `folder` |
| `kit:knowledge/jira` | Copies Jira work items into the project's knowledge as markdown, one file each. Needs a CLI tool that runs the Atlassian CLI signed in, and jq. | `keys`, `tool`, `folder` |
| `kit:knowledge/review-learnings` | Shows what agents proposed to learn about the project, and asks you to keep or delete it. Agents read what you keep. | none |
| `kit:knowledge/web` | Copies web pages into the project's knowledge as markdown. It needs no account. Each page gets a file named after its address. A page that cannot be read does not stop the others. | `urls`, `folder` |
<!-- /generated:knowledge-kits -->

Any flow that writes markdown into `$NS_KNOWLEDGE` is a source too.

## Learnings

An agent can propose what it learned about the project: short notes that help the next agent. A proposed note waits for you. No agent reads it until you keep it.

The **Review** page shows each note, with the notes close to it. Keep it, delete it, or put it off. The keys are K, D, and S. The `review-learnings` starter flow asks you in a Gate in place of the page.

## Search

The Knowledge page has a search field. Search finds a file by its words. When Ollama runs, search also finds a section by its meaning, so a question in other words finds the answer too.

To search by meaning on your own computer:

1. Install Ollama from https://ollama.com.
2. Open **Settings**, then **Meaning search**.
3. Click **Download**, or run `ollama pull qwen3-embedding:0.6b` (639 MB).

The Docker image has Ollama inside. A Host starts it by itself, and downloads the model at its first start. The Knowledge page tells you when search by meaning stopped.

## The Map

The Map shows the files, the topics that they share, the links between them, and the files close in meaning. It also shows the questions that found them, and the learnings that name their topics. No model makes the Map, and agents do not get it.

## More

[docs/knowledge.md](https://github.com/xiduzo/nightshift/blob/main/docs/knowledge.md) tells how the knowledge syncs between computers, how search works, and how it is measured.
