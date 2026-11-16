# Agents and profiles

An agent is an AI program that works on its own, such as Claude Code or Codex. Night Shift starts an agent for each Agent step of a run, with your own login. A profile is a saved setup of an agent, with a name that a node can pick.

Read this page to set up an agent, make profiles for cheap and strong steps, and give an agent tools. All of it is in **Settings**. The Settings menu at the bottom of the sidebar opens each page.

## Set up an agent

Night Shift can install Claude Code or Codex for you, and sign you in. Do this on the computer that runs the agent.

1. Open **Settings**, then **Your harnesses**. A harness is the program that an agent runs on.
2. Choose **Set up an agent**.
3. Choose Claude Code or Codex. Night Shift recommends Claude Code.
4. Choose **Install Claude Code** or **Install Codex**. Night Shift asks before it starts. **Details** shows what it runs.
5. Choose **Install**. Night Shift downloads the agent from Anthropic or OpenAI. It needs no administrator password.
6. When the install ends, choose **Sign in to Claude** or **Sign in to ChatGPT**.
7. Finish the sign-in in your browser. If the page shows a code, paste it in the **Code** field.

Night Shift then adds the agent with a profile.

If you have not chosen a decider yet, the setup asks for one: **Local** or **TypeSafe Jev**. Choose **Skip** to keep the default. Then the profile opens. See [Models that decide](#models-that-decide).

While this computer has no agent, Home offers the same setup. Choose **Set up** in **Get started**. On Home, the profile does not open, so that you can continue with the next step. See [Get started](Get-started.md#2-follow-get-started-on-home).

- An agent that is on this computer already skips the install.
- An agent that is signed in already shows **Add Claude Code** or **Add Codex**.
- The page of a harness shows **Install** when its agent is missing, and **Sign in** when it is signed out.

Night Shift sets up an agent only on the computer that you use, on macOS and Linux. See [Setup is not available](Troubleshooting.md#setup-is-not-available).

## Profiles

A profile holds the setup of an agent under one name: the agent, the model, the effort, and the permission mode. An Agent node names the profile that runs its step.

To make a profile:

1. Open **Settings**, then **Your agents**.
2. Choose **Add profile**.
3. Give it a name, and choose the agent, the model, and the permission mode.

### Which profile for which step

Make two or three profiles, and give each step the cheapest one that does it well. For example:

| Profile | Model | Use it for |
| --- | --- | --- |
| `sonnet` | A mid-size model, such as Claude Sonnet | Most steps: research, summaries, small changes. |
| `opus` | A large model, such as Claude Opus | Hard steps, and the second try when a cheap try fails. |

A step can try the cheap profile first and move up to the strong one when a try fails. See [Cascade](Flows-and-nodes.md#cascade).

A profile belongs to its computer. A node names the profile and its computer, for example "sonnet on LE2316". Night Shift never looks for a profile of the same name on another computer.

### Permission modes

The permission mode says what the agent may do without your approval.

| Mode | What the agent does |
| --- | --- |
| **Auto** | Approves safe actions itself, such as tests, reads, and edits. Blocks risky ones. Use it for runs without you. |
| **Accept edits** | Edits files. Runs no commands without your approval. |
| **Ask for each tool** | Asks before each tool. Without you there, the agent stops. |
| **Plan only** | Reads the project and writes a plan. Changes nothing. |
| **Bypass permissions** | Runs every tool and shell command without asking. Use it only on a project that you trust. |

A run without you needs **Auto**. **Accept edits** and **Ask for each tool** cannot run shell commands, such as `git commit`, when nobody is there to approve them. The flow editor warns about an Agent node whose profile uses one of these modes.

### Backups

A node can list up to five backups. A backup is a profile on another computer. When the computer of the node is offline, the first backup that can take the step runs it.

A node without backups waits for its computer until the stop time of the run. Night Shift tells you that the step waits.

## Which agents work

<!-- generated:harnesses: bun run docs:reference writes this table from the code. Do not edit it here. -->
| Agent | Login and model | Night Shift's own tools | Where your files go |
| --- | --- | --- | --- |
| **Claude Code** | Uses your Claude login. Model: an alias such as sonnet, or a full model id. | Yes | Prompts and your project's files go to Anthropic under your Claude login. |
| **OpenCode** | Model: provider/model. | Yes | Prompts and project files go to the model provider set in OpenCode. |
| **Codex** | Not fully tested yet. Uses your Codex login. | Yes | Prompts and project files go to OpenAI under your Codex login. |
| **Grok Build** | Not fully tested yet. Run grok login once to use your Grok login. | No | Prompts and project files go to xAI under your Grok login. |
| **GitHub Copilot** | Not fully tested yet. Uses your GitHub login. Model default: the model set in Copilot. | Yes | Prompts and project files go to GitHub Copilot under your GitHub login. |
| **Gemini CLI** | Not fully tested yet. Uses your Gemini CLI login. Model default: the model set in Gemini CLI. | Yes | Prompts and project files go to Google under your Gemini CLI login. |
| **Cursor** | Not fully tested yet. Run agent login once to use your Cursor login. | Yes | Prompts and project files go to Cursor under your Cursor login. |
| **pi** | Needs pi 0.81 or later. Model: provider/model, for example ollama/qwen3-coder:latest. | No | Prompts and project files go to the model provider set in pi. With a local model, they stay on this computer. |
<!-- /generated:harnesses -->

All real work so far runs on Claude Code. pi is verified with an Ollama model.

"Night Shift's own tools" are the tools that Night Shift gives a session, such as knowledge search. An agent without them still works on the project files.

## CLI tools

A node can give the agent CLI tools, such as `gh` for GitHub or `acli` for Jira. A Command node can use them too.

1. Open **Settings**, then **Tools**, on the computer that runs the step.
2. Choose **Add tool**, and pick the program.
3. Select the Agent node, open its **Setup** tab, and pick the tool under **Tools**.

A profile can also give tools to every step that uses it.

A tool without a login signs in the way the program does on that computer. For example, `gh` uses the account of `gh auth login`.

### Two accounts for one program

A tool can have its own login. A login sets environment variables for the program, and a value can read a secret. So one program can run as two accounts:

| Tool | Program | Login |
| --- | --- | --- |
| `gh` | `gh` | Your own GitHub login |
| `gh-work` | `gh` | `GH_TOKEN = ${GH_WORK_TOKEN}` |

The agent types the name of the tool. A command also uses the name of the tool, for example `gh-work pr list`. The plain program name runs without the login. Say which account a tool uses in its description.

## Connections

A connection is an MCP server: a program that gives an agent more tools, such as a browser or a design app. A node lists the connections that its agent gets. A Tool node calls one tool of a connection, with no agent.

To add one, open **Settings**, then **Tools**, and choose **Add MCP server**.

A `${NAME}` in a connection reads a secret, for example an API key. See [Secrets](Computers-and-Hosts.md#secrets).

## Night Shift's agents

Night Shift also has seven agents of its own. They help you build, explain, and decide. Each has one job. You choose who answers for each: one of your agents, or one of your models.

| Agent | Its job | You start it with | Who can answer |
| --- | --- | --- | --- |
| **Builder** | Makes a flow from a sentence, and changes it when you ask. | **Build with an agent** in the flow editor | An agent |
| **Improver** | Finds what goes wrong or costs too much in a flow, and proposes a change. | **Improve this flow** on a run and on Spend | An agent |
| **Explainer** | Says why a run stopped early, and what you can do. | **Ask why** on a run, on Home and on your phone | An agent or a model |
| **Field writer** | Fills one field, with a preview. | **Suggest …** under a field | An agent or a model |
| **Learner** | Proposes what to learn from a run that needed a fix or your answer. | A run that ends, unless the project turns it off | An agent or a model |
| **Decider** | Picks an option in a run. | A Decision or a Value that a model decides | A model |
| **Brief writer** | Writes what a Gate asks you, and how urgent it is. | Every Gate, unless its author turns it off | A model |

An agent works in turns and can read the files of your project. A model gives one answer: it is faster and costs less. The Builder and the Improver need an agent that takes Night Shift's own tools. See [Which agents work](#which-agents-work).

These agents only read and propose. You apply a change, and you save the flow. None of them reads a secret, opens another project, or starts a run.

To choose who answers:

1. Open **Settings**, then **Night Shift's agents**.
2. In the row of an agent, choose an agent or a model under **Answers with**. Night Shift saves the choice at once.
3. To see what an agent reads and proposes, choose its name. **Try it** asks the agent one small question and shows whether it answers.

An agent without a choice uses the first of your agents that works, or the default model. The choice belongs to one computer. A Host has its own.

For one question, you can pick another agent, model, or effort where you ask. The message box of the chat and of each **Suggest …** shows who answers, under the text. **Ask why** shows it beside the button, and on your phone above it. Settings does not change. Choose **Default** to go back. **New chat** starts on the default again.

One answer has a limit. The Builder and the Improver stop after 40 turns or $2.00. Ask again to continue. The Spend page shows what these agents cost, as **Help**. In a Space that a Host keeps, it shows the cost from every computer in the Space.

A node that names its own decider or its own profile keeps it. The Decider answers only for a node that names none.

## Models that decide

A Decision or a Value can let a model pick, in place of a rule or a person. That model is a decider. A Model Profile holds the decider and its model. Make one in **Settings**, under **Models**.

- **Local** runs Ollama on this computer. It is private and needs no account.
- **TypeSafe Jev** is a small model on the internet that only picks one of your options. It is the fastest, and it needs a key from TypeSafe.

Other deciders include OpenAI Decisions. See [Deciders](Flows-and-nodes.md#deciders).

## Advanced

- **Share a profile with a Space.** An Offer lets the people of a Space run steps on one of your profiles. See [Offers](Computers-and-Hosts.md#offers).
- **Another agent.** Any agent that speaks the Agent Client Protocol works too. Add it in **Your harnesses** as a custom agent, with its command, for example `goose acp`.
- **A model on your own server.** A Model Profile can name an address. See [A model on your own server](https://github.com/xiduzo/nightshift/blob/main/docs/deploy/local-models.md).
