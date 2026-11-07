# Agents and profiles

An Agent node names the coding agent that it runs on. Agents run with your own CLI logins. One flow can mix them.

## Agents

<!-- generated:harnesses: bun run docs:reference writes this table from the code. Do not edit it here. -->
| Agent | Login and model | Night Shift's own tools | Where your code goes |
| --- | --- | --- | --- |
| **Claude Code** | Uses your Claude login. Model: an alias such as sonnet, or a full model id. | Yes | Prompts and your project's code go to Anthropic under your Claude login. |
| **OpenCode** | Needs OpenCode 1.x. Version 2.x does not work yet. Model: provider/model. | Yes | Prompts and code go to the model provider set in OpenCode. |
| **Codex** | Not fully tested yet. Uses your Codex login. | Yes | Prompts and code go to OpenAI under your Codex login. |
| **Grok Build** | Not fully tested yet. Run grok login once to use your Grok login. | No | Prompts and code go to xAI under your Grok login. |
| **GitHub Copilot** | Not fully tested yet. Uses your GitHub login. Model default: the model set in Copilot. | Yes | Prompts and code go to GitHub Copilot under your GitHub login. |
| **Gemini CLI** | Not fully tested yet. Uses your Gemini CLI login. Model default: the model set in Gemini CLI. | Yes | Prompts and code go to Google under your Gemini CLI login. |
| **Cursor** | Not fully tested yet. Run agent login once to use your Cursor login. | Yes | Prompts and code go to Cursor under your Cursor login. |
| **pi** | Needs pi 0.81 or later. Model: provider/model, for example ollama/qwen3-coder:latest. | No | Prompts and code go to the model provider set in pi. With a local model, they stay on this computer. |
<!-- /generated:harnesses -->

Every real night so far runs on Claude Code. pi is verified with an Ollama model.

"Night Shift's own tools" are the tools that Night Shift gives a session, such as knowledge search. An agent without them still works on the code.

Any other agent that speaks the Agent Client Protocol works too. Add it on the Agents page as a custom agent, with its command, for example `goose acp`.

## Profiles

A profile holds an agent's setup under one name: the agent, the model, the effort, and the permission mode. A Model Profile holds the model of a Decision or a Value. You make profiles on the Agents page of each computer.

A profile belongs to its computer. A node names the profile and its computer, for example "builder on LE2316". Night Shift never looks for a profile of the same name on another computer.

A Model Profile can name an address, for a model on your own server. See [A model on your own server](https://github.com/xiduzo/nightshift/blob/main/docs/deploy/local-models.md).

### Permission modes

An unattended night needs **Auto**. Auto approves safe actions, such as tests, reads, and edits, and blocks risky ones.

**Accept edits** and **Ask for each tool** cannot run shell commands, such as `git commit`, when nobody is there to approve them. The flow editor warns about an Agent node whose profile uses one of these modes.

### Backups

A node can list up to five backups. A backup is a profile on another computer. When the node's computer is offline, the first backup that can take the step runs it.

A node without backups waits for its computer until the stop time of the run. Night Shift tells you that the step waits.

## CLI tools

A node can give the agent CLI tools, such as `gh` or `acli`. Add a tool on the Agents page of the computer that runs the step.

A tool can have its own login. A login sets variables for the program, and a value can read a secret, for example `GH_TOKEN = ${GH_WORK_TOKEN}`. So one program can run as two accounts:

| Tool | Program | Login |
| --- | --- | --- |
| `gh` | `gh` | Your own GitHub login |
| `gh-work` | `gh` | `GH_TOKEN = ${GH_WORK_TOKEN}` |

The agent types the tool's name. A command also uses the tool's name, for example `gh-work pr list`. The plain program name runs without the login. Say which account a tool is in its description.

A tool without a login signs in the way the program does on that computer.

## Connections

A connection is an MCP server. A node lists the connections that its agent gets. A Tool node calls one tool of a connection.

A `${NAME}` in a connection reads a secret. See [Secrets](Computers-and-Hosts.md#secrets).

## Share a profile with a Space

An Offer lets the people of a Space run steps on one of your profiles. See [Offers](Computers-and-Hosts.md#offers).
