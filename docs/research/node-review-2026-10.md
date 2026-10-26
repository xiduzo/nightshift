# Node review

2026-10-26. Follows `foundational-nodes.md` (2026-10-17). That document chose
seven node types from first principles. This one checks them against use:
which fields carry weight, which nodes nobody draws, what flows build by hand
again and again, and where an integration would earn its place. It also
compares the palette with the built-in pieces of n8n and Zapier.

## 1. Evidence

18 flow files on the author's computer: five flows of a client project, the
rpgdotexe night (three flows), the starters (six) and a scratch flow. 153
nodes in total. Only shapes and counts appear here, never prompts or commands.

| Node | Uses | Notes |
| --- | --- | --- |
| Command | 73 | 55 with `output: "json"` |
| Agent | 31 | 23 set harness, model and permission mode inline; 8 name a profile |
| Decision | 31 | 16 by person, 15 by rule, **0 by model** |
| Call | 7 | 6 with `each` (4 command, 1 files, 1 json source), 1 without |
| Value | 7 | all by rule, **0 by model** |
| Wait | 4 | all `command`, each polling `gh run`; **0** time, duration or signal |
| Tool | **0** | the daemon has **0** Connections |

Agent fields never set: `checker` (0), `connections` (0), `mcpServers` (0).
`nodeClis` is set twice. The daemon has two CLI tools (`gh`, `acli`) and three
profiles.

Glue that flows build by hand:

| Pattern | Flows |
| --- | --- |
| Push, then find or create a draft pull request, print it as JSON | 5 |
| Make a pull request ready, or close it with a comment | 3 |
| Create a branch from the newest main, print it as JSON | 3 |
| Agent `needs-input` → Gate with `answer`/`stop` → back to the Agent with `{{ask.note}}` | 5 |
| A Command whose only job is to `echo` "nothing to do" and end the run | 3 |
| State kept between runs in a file next to `.git`, or in a marker in pull request bodies | 2 |
| Wait on a GitHub Actions run with a polling command | 2 (5 nodes) |
| Four read-only reviewers in a row, then a rule that merges their findings | 1 |

## 2. Too much configuration, or not used

### 2.1 Agent: about 20 fields, profiles do not carry them — **Strong**

Profiles live on the daemon, flows live in the repo. A flow that names a
profile does not run on a computer without it, so authors write every field
inline. The result is the same five fields on almost every Agent node.

- Remove `checker`. It is a Decision by model inside the Agent: the deletion
  test passes the other way (delete it and nothing scatters). 0 uses.
- Remove `mcpServers`. It duplicates Connections and invites secrets into a
  file in a repo. 0 uses.
- Merge `nodeClis` into `clis`. Two lists for one idea. 2 uses.
- Make the profile the first field of the inspector and the inline fields its
  overrides. Consider profiles that live in the repo
  (`.nightshift/profiles.json`), so a flow that names one stays portable.

### 2.2 Two ways to choose a model — **Worth exploring**

An Agent picks a model through a profile. A Decision, a Value and the checker
pick one through `decider` plus `model`. Five deciders exist, a Value accepts
three of them, and both by-model producers have 0 uses. Keep the producers,
they are cheap. Fold deciders into profiles, so one setting answers "which
model".

### 2.3 `decider` in files that do not use it — **Strong**, tiny

`decider` has a schema default, so it is written into 26 Decisions decided by
a person or a rule, and into Values made by a rule. Make it optional and read
it only with `by: "model"`.

### 2.4 Command output: stdout is the JSON channel — **Strong**

Flow after flow repeats the comment "only the JSON at the end goes to stdout:
git talks on stderr". One stray `echo` ends the step on the catch-all. Give
the command a file for its data, as GitHub Actions does with
`$GITHUB_OUTPUT`: `$NS_OUTPUT`, read as JSON when the command ends. Keep
stdout as the log.

Flows also invent exit codes (3, 4, 5, 6) only to route. Let a Command with
JSON data pick its outcome from `data.outcome` when it lists that outcome.
Exit codes stay for commands that are not written for Night Shift.

### 2.5 Call with `each` does four jobs — **Speculative**

It repeats a body, orders the elements (`dependsOn`, `done`, blocked), applies
a branch policy (`per-item` stacks a branch per element) and reads its source
again before each element. The stack is the method of the old night script
inside the engine, against "the flow is the method". It works and the night
uses it, so nothing changes now. The `files` source is a Command with `git
ls-files` and can go when the next flow version comes.

### 2.6 Nodes with no uses

Tool, Value by model, Decision by model, and Wait by time, duration and signal
have no uses. None of them is obsolete: each is small, and each has a clear
job that no other node does. Tool stays a primitive for an MCP server that a
person brings. Night Shift does not build its own integrations on it (§6).

## 3. Too little configuration

### 3.1 A Gate has no deadline — **Strong**

The engine gives a Gate no time budget: it waits until someone answers. A
night product needs "if nobody answers by 07:00, take `keep`". Zapier's
approvals and n8n's send-and-wait both time out.

```jsonc
{ "type": "decision", "by": "person", "options": [ … ],
  "deadline": { "at": "07:00", "choose": "keep" } }
```

`at` takes the same values as a Wait by time. `choose` names an option. The
note says the deadline chose it.

### 3.2 An Agent cannot ask a person by itself — **Strong**

Five flows wire the same loop: `needs-input` to a Gate with `answer` and
`stop`, and back to the Agent, whose prompt reads `{{ask.note}}` and whose
session resumes. One field does the same:

```jsonc
{ "type": "agent", "session": "resume", "ask": "person" }
```

On `needs-input` the engine opens a Gate with the agent's summary and
questions, and resumes the same session with the answer. Stop on the Gate
ends the step `fail`. This is the shape of `checker`, which §2.1 removes. The
difference is use: five flows against none.

## 4. Splits

None in the file format. Decision with `by` stays one seam. In the editor,
though, a Decision by rule is an `if` (15 uses, all routing), and a Decision
by person is a Gate that gains its own features (lock screen, the deadline of
§3.1). Two palette entries, **Gate** and **Branch**, that both write a
`decision` node, match the words people look for.

## 5. Missing pieces

### 5.1 Parallel branches and a join — **Strong**, the most work

A feature flow runs four reviewers one after another. They do not change the
worktree, they use different models and prompts, and a rule merges their
findings at the end. n8n joins branches with Merge. Zapier's classic Paths
never join, and its 2026 Next Gen Zaps add a rejoin. LangGraph runs parallel
branches and joins them natively.

`each.parallel` does not cover this case: the branches are not one body over a
list. The shape is parallel edges out of one outcome, and a **Join** node that
waits for all of them (or the first) and holds each branch's outputs. The hard
part is the worktree: parallel branches either do not write, or each gets its
own copy.

### 5.2 Memory between runs — **Strong**

One flow keeps a skip list in a file next to `.git`, and finds its earlier
pull requests by a marker in their body. Another keeps each session's report
next to `.git`, so the next run reads it. n8n has Data Tables, Zapier has
Storage. This is not a node:

```jsonc
{ "name": "skipped", "type": "json", "initial": "[]", "keep": "project" }
```

A kept variable starts from its last value in this project, and `set` writes
it as today. Duplicate checks are JSONata over the list.

### 5.3 End with a status — **Strong**

Three flows end with a Command that only prints "nothing to do". The run then
shows as finished, the same as a run that opened a pull request. An End node
sets the run's result (`done`, `nothing-to-do`, `failed`) and one line of
text, which the runs list and the notification show. n8n's Stop and Error and
Zapier's "Handled" do this.

### 5.4 Events from outside — **Strong**, see §6

A run can receive a signal through the API, by run id. Nothing outside Night
Shift can start a run or wake a Wait. Every wait on CI is a polling command.

### 5.5 A person approves one tool call — **Speculative**

n8n can ask a person before an agent calls a chosen tool. For Night Shift: a
Gate inside a session for calls such as `gh pr merge`, at 03:00 in `auto`
permission mode. Watch for a flow that needs it.

### 5.6 Still not nodes

The table in `foundational-nodes.md` §4 holds against both catalogs. HTTP,
Code, Filter, Sort, Remove Duplicates, Formatter and Notify are a Command or a
Value by rule. Digest is the night itself.

## 6. GitHub and other tools

Night Shift stays foundational: the engine knows no tracker, and Night Shift
builds no integration on another product's tools. It builds on fundamentals
only: cron, webhooks, shell commands and the CLIs a person already has, files
and git. A vendor's MCP server is something a person may bring as a
Connection, never the base of what Night Shift ships.

GitHub glue is the code flows repeat most (§1). Three ways to answer it:

| Option | Verdict |
| --- | --- |
| A GitHub node with operations, as n8n has | **No.** The engine learns a tracker, and Night Shift keeps an API surface that `gh` already keeps. Tool logins already solve how `gh` signs in. |
| Kits: flows that ship with Night Shift, run by a Call | **Yes.** `github/publish-draft-pr`, `github/wait-for-checks`, `jira/assign`. Plain flows of Commands on the CLI, which a person can read and copy. A Call names one as `kit:github/publish-draft-pr`. The engine still knows no tracker. |
| Events in: a webhook starts a run or wakes a Wait | **Yes.** The gap a CLI cannot fill, and a fundamental: an HTTP request with a secret. The Host has a public address. A webhook becomes a trigger next to the cron of a Schedule, and a `signal` for a Wait. It replaces each polling loop. |

The same holds for Jira and Linear: kits on their CLIs, and events where the
service sends webhooks.

## 7. Order of work

1. Cleanup: remove `checker`, `mcpServers` and `nodeClis`; make `decider`
   optional; add `$NS_OUTPUT` (§2.1, §2.3, §2.4). One flow version.
2. The Gate's deadline and the End node (§3.1, §5.3).
3. Kept variables (§5.2).
4. The Agent's `ask: "person"` (§3.2).
5. Kits, from what still hurts (§6).
6. Webhook triggers and signals (§5.4, §6).
7. Parallel branches and Join (§5.1).

## 8. Built

2026-10-27, on the branch `explore/node-review`. Flow files are version 6.
A version 5 file migrates when Night Shift reads it.

| Review | Built | Different from the review |
| --- | --- | --- |
| §2.1 Agent | `checker` and `mcpServers` go. `nodeClis` joins `clis`. The inspector shows the profile first, and the harness, model and permission mode as its overrides. | — |
| §2.1, §2.2 Profiles | A project has `.nightshift/profiles.json`. An Agent Profile is for Agents, a Model Profile (a decider and a model) for a Decision or a Value by model, which can name `profile`. | The computer's profile of a name wins over the project's. The web shows a project's profiles but does not edit them. |
| §2.3 `decider` | Optional, read only with `by: "model"`. The migration removes it from the other Decisions and Values. | — |
| §2.4 Command data | `$NS_OUTPUT`: JSON in that file is the step's data, whatever `output` says. `output: "json"` reads stdout only when the file stays empty. Data with an `outcome` that names an exit ends the step there. An exit with `"code": "data"` is picked by data only. | — |
| §2.5 `each` | The `files` source goes. The migration makes it a `command` source with `git ls-files`. | The rest of `each` stays as it is. |
| §3.1 Gate deadline | `deadline: { at, choose }`, or `minutes` instead of `at`. The note says the deadline chose. | — |
| §3.2 Agent asks | `ask: "person"`. On `needs-input`, a Gate opens with "answer" and "stop". The answer goes to the same session. | An edge on `needs-input` is an error with `ask`. |
| §4 Palette | **Gate** and **Branch** both write a `decision` node. A Decision by model is a choice in the inspector. | — |
| §5.1 Parallel branches | Two or more edges without `max` on one outcome are a fan-out. Each branch ends at one **Join** (`wait: "all"` or `"first"`). | The branches move in lock-step and share the run's copy of the project. Two Agents that can edit files get a warning. A fan-out inside a branch is an error: use a called flow. While one branch waits for a person or a Wait, the others pause. An answer to a Gate while another branch runs is refused. |
| §5.2 Kept variables | `keep: "project"`: a run starts from the last saved value of this flow and variable. A person can reset it on the flow's page. | The value stays on the computer that walks the run. Another computer does not see it. |
| §5.3 End | **End** with `done`, `nothing-to-do` or `failed`, and a one-line message. `done` and `nothing-to-do` end the run `finished`, `failed` ends it `failed`. A failed End can be rerun, not resumed. In a called flow, the Call ends `pass` or `fail`, with `ended` and `end_message`. | An End on a branch of a fan-out is an error: put it after the Join. |
| §5.4, §6 Webhooks | A schedule has `cron` or `webhook` (a secret by name, a `when` rule). Its inputs read the event. A webhook can send a `signal` with a `key`, which wakes the Waits on that name and key. The Schedules page shows the address and the recent deliveries. | Only the computer that fires the schedule takes its webhook: the Host does not pass it on to another computer. The recent deliveries, refused ones too, stay in memory and go when Night Shift restarts. |
| §6 Kits | Six kits, run by a Call as `kit:<group>/<name>`: `github/create-branch`, `github/publish-draft-pr`, `github/finish-pr`, `github/wait-for-checks`, `jira/assign`, `jira/move`. The Call's flow picker lists them. | A kit is read only. To change one, copy it into the project as a normal flow. |
| §5.5 Approve one tool call | Not built, on purpose. | Watch for a flow that needs it. |

Night Shift's own `.nightshift/` uses most of it: `pr-review` (a webhook, a
fan-out of three reviews into a Join, a Decision by a Model Profile),
`night-chores` (a kept variable, the GitHub kits, an Agent that asks, a Gate
with a deadline) and `dependency-bump`. Their schedules are off.

Left to do:

- Parallel branches that edit files, each in its own copy of the project.
- A Host that passes a webhook on to the computer that fires the schedule.
- Recent deliveries that survive a restart.
- Kept values that every computer of a Space can read.
- Edit a project's profiles in the web.
- Kits for Linear, and events from Jira and Linear.

## Sources

- n8n: docs.n8n.io/integrations/builtin/core-nodes/ (Wait, Merge, Loop Over
  Items, Execute Sub-workflow, Data Table, Chat, Guardrails, MCP Server
  Trigger); docs.n8n.io/flow-logic/error-handling/;
  docs.n8n.io/flow-logic/execution-order/;
  docs.n8n.io/advanced-ai/human-in-the-loop-tools/. Read 2026-10-26.
- Zapier: help.zapier.com articles on Paths, Delay, Digest, Looping, Sub-Zap,
  custom error handling, Human in the Loop, Next Gen Zaps and AI Guardrails;
  docs.zapier.com/mcp/overview/how-tools-work. Read 2026-10-26.
