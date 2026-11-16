# How Night Shift works

This page tells the main words of Night Shift, and how they fit together. Read it once before you build a flow. The other pages use the same words.

## The short version

1. You make a **project** for a body of work.
2. In the project, you draw a **flow**: the steps of a job, as boxes and arrows.
3. Each box is a **node**. A node does one thing: it runs an agent, runs a command, reads a web page, or makes a choice.
4. You start the flow. Night Shift makes a **run** and does the nodes one by one.
5. When the flow needs you, a **Gate** waits in your inbox. The run continues after you answer.
6. A **schedule** starts the flow for you, for example each night at 22:00.

## Projects

A project is a place for one body of work, such as "Market research" or "My website". It holds the flows, schedules, runs, secrets, and knowledge of that work.

A project can have a folder on your computer, but it does not need one. Code, documents, and data usually have a folder. Research or outreach often needs no folder.

Night Shift never changes the files in your folder. Each run works in its own copy of the project. Night Shift keeps your flows outside your folder too.

## Flows and nodes

A flow is a graph of nodes. An arrow (an **edge**) goes from one node to the next.

Every node ends with an **outcome**, such as `pass` or `fail`. Each edge starts from one outcome. So the outcome picks the next node. An Agent can have its own outcomes, such as `found` and `nothing`. A Gate has one outcome for each option that it offers you.

The nodes are in five families:

| Family | Nodes | Use them to |
| --- | --- | --- |
| **Do** | Agent, Command, Tool, Web request | Do the work: run an agent, a shell command, or an HTTP request. |
| **Decide** | Gate, Branch, Decision | Pick the next step. You pick in a Gate. A rule picks in a Branch. A model picks in a Decision. |
| **Shape** | Value, Convert, Since last run | Change data: read a CSV file or a feed, filter a list, keep only what is new. |
| **Hold** | Wait, Lease, Service | Wait for a time or a signal, or start a server for the next steps. |
| **Compose** | Subflow, Join, End | Run another flow, wait for parallel branches, or end the run with a report. |

[Flows and nodes](Flows-and-nodes.md) tells each node type.

## Data between nodes

Each node gives data to the nodes after it. A later node reads it with a **template**: two curly brackets around the id of the node and a field.

| Template | Gives |
| --- | --- |
| `{{topic}}` | The flow input `topic`. |
| `{{news.data.items}}` | The field `items` of the data of the node `news`. |
| `{{summary.output}}` | The final message of the Agent node `summary`. |

The id of a node is the short name under its title in the editor. Give each node a clear id, such as `news` or `summary`. Then your templates are easy to read.

A flow can have **inputs**, like the arguments of a script. The start dialog asks for them.

## Runs

A run is one time that a flow runs. Each node that the run does is a **step**. The run page shows each step live: what the agent does, the files it changed, and what it cost.

A run ends in one of three ways: **Done**, **Nothing to do**, or **Failed**. An End node can also write a **report**: what the run produced, in Markdown. Home shows the latest report of each flow.

You can stop a run, and resume it later at its last step.

## Gates and the inbox

A Gate is a question that waits for you. It shows the options, and what each option does. You answer it in the inbox, on your computer or on your phone.

Use a Gate for two things:

- **Approval.** Ask before an act that you cannot undo, such as a sent email or a published post.
- **Fallback.** Ask when a rule or a model cannot decide.

Do not put a Gate on every step. Then you are back to babysitting. See [Gates and the inbox](Gates-and-the-inbox.md).

## Agents and profiles

An **agent** is an AI tool that works on its own, such as Claude Code or Codex. Night Shift starts it, gives it a prompt, and reads what it did. The agent uses your own login.

A **profile** is a saved agent setup with a name: the agent, the model, and how much it may do without you. An Agent node names the profile that it runs on. For example, a cheap profile for easy steps, and a strong profile for hard steps.

Night Shift also has its own helper agents. They build a flow from a sentence, explain why a run failed, and propose fixes. They never change a flow without you. See [Agents and profiles](Agents-and-profiles.md).

## Schedules and webhooks

A schedule starts a flow for you, at a time or on a cron line such as `0 7 * * 1-5`. A webhook starts a flow when another tool calls an address, for example GitHub Actions, n8n, or a script. See [Runs and schedules](Runs-and-schedules.md).

A schedule needs a computer that is on. To run schedules while your laptop sleeps, run Night Shift on a server as a **Host**. See [Computers and Hosts](Computers-and-Hosts.md).

## Knowledge and secrets

**Knowledge** is the files that your agents read besides the project files: notes, web pages, documents. See [Knowledge](Knowledge.md).

A **secret** is a password or a key, such as an API token. You save it once on the Secrets page. A node reads it as `${NAME}`, and Night Shift never shows its value. See [Secrets](Computers-and-Hosts.md#secrets).

## Next

[Build your first flow](Your-first-flow.md).
