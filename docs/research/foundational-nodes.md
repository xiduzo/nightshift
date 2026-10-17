# Foundational nodes

2026-10-17. What the smallest set of node types is that lets a person draw any
night, and which of today's nodes should merge. Follows the 2026-10-16 direction:
a thin wrapper over LangGraph, no tracker and no method in the engine, structured
outputs tied together by the flow, the CLI and MCP.

## 1. The contract every node already obeys

A node reads earlier values through templates and ends a Step with two things:

- a **label** (the Outcome): one edge per label leaves the node;
- a **value** (its outputs, `data` when structured): later nodes read it with
  `{{node.path}}`.

Everything else about a node is *who produces* the label and the value. Today:

| Producer | Label | Value |
| --- | --- | --- |
| a person | Decision `by: person` (a Gate) | the Gate's `note` only (free text) |
| a rule (JSONata) | Decision `by: rule` | — |
| a small model | Decision `by: model` | — |
| a coding agent | Agent `outcomes` | Agent `data` against an Output Schema |
| a shell command | Command exit code | Command stdout (`log_tail`; JSON only in a For Each source) |
| an MCP tool | — | — |
| time or the outside world | — | — |
| another flow | Subflow `pass`/`fail`, For Each `done`/`halted` | the flow's outputs, `results` |

Reading the table row by row says where the gaps are. The Decision node covers
the label column for three producers under one `by` field, which is why a Gate
is not a node of its own (the palette lost its second entry today). The value
column for the same three producers is empty: there is no way to *compute* a
value, *extract* one with a model, or *ask* a person for one, without starting
a harness session or writing shell.

The rule for a foundational node, from the codebase-design vocabulary:

- **One interface.** A node type is one seam with one shape of inputs and one
  shape of outputs. A field that switches who fills it (`by`) is fine; a field
  that changes what the node *is* is a second node hiding in the first.
- **The deletion test.** Deleting the node must scatter complexity across
  flows (people rebuild it from an Agent and shell every time). If an Agent or
  a Command does the job well, it is not a node.
- **No method, no tracker.** GitHub, Jira, WTF are prompts, commands, recipes
  and connections. Never a node.

## 2. Today's five, assessed

| Node | Verdict |
| --- | --- |
| Agent | Foundational. Both columns, every producer behind it is the harness. Keep. |
| Command | Foundational. The CLI leg of "flow + CLI + MCP". Keep. One gap: its stdout is text; a flag `output: "json"` that parses stdout into `data` would give it the value column for free (the For Each command source does this already). |
| Decision | Foundational since the `by` merge. Keep. |
| Subflow | Not foundational: it is For Each with a list of one. See §3.1. |
| For Each | Foundational (composition), but its Subflow half is duplicated. See §3.1. |

## 3. Proposals, ranked

### 3.1 Call: Subflow and For Each are one node — **Strong**

A Subflow runs a flow once with bound inputs. A For Each runs a flow once per
element with bound inputs plus the element. The engine already runs both bodies
through `runBody`; the editor has two inspectors, two palette entries and two
glossary rows for one idea.

```jsonc
{ "type": "call", "flow": "work-item", "inputs": { "epic": "{{epic}}" },
  // optional: run once per element instead of once
  "each": { "source": { "kind": "command", "command": "gh …" }, "as": "item",
            "branch": "per-item", "haltOn": ["halt"], "maxItems": 20 } }
```

- Outcomes: `pass` / `fail` without `each`; `done` / `halted` with it (handles
  change with a field, as an Agent's `outcomes` already do).
- Outputs: the called flow's outputs and `ended` without `each`; `results` with it.
- Migration: `subflow` → `call`, `foreach` → `call` + `each`. Mechanical, flow
  version 4.
- Deletion test passes: delete Subflow and nothing is lost; delete For Each and
  every night rebuilds a loop over a list by hand.
- Later, not now: `each.parallel: n` with LangGraph `Send`, which needs one
  worktree per element and only makes sense for `branch: "shared"`-free bodies.

### 3.2 Value: the value column for person, rule and model — **Strong** (rule), **Worth exploring** (model), **Speculative** (person)

The twin of Decision. Decision picks a *label*; Value produces *data* that
matches an Output Schema, and `by` says who:

```jsonc
{ "type": "value", "by": "rule",
  "expression": "$filter(planner.data.tasks, function($t) { $t.size = 'small' })",
  "output": { "type": "array" } }

{ "type": "value", "by": "model", "decider": "typesafe",
  "prompt": "Extract the failing test names from {{check.log_tail}}",
  "output": { "type": "object", "properties": { "tests": { "type": "array" } } } }

{ "type": "value", "by": "person",
  "prompt": "Which branch should the stack build on?",
  "output": { "type": "object", "properties": { "base": { "type": "string" } } } }
```

- Outcomes: `pass`, `fail` (the result does not match the schema, or the
  expression throws). Outputs: `data`, `note`.
- `by: rule` is JSONata, the same engine as a Rule, with the same context
  (`ruleContext`). Today people do this with a Command node, `jq`, and shell
  quoting of template environment variables. Deletion test passes.
- `by: model` is TanStack AI `chat()` with `outputSchema` on the Decision's
  decider: one call, no harness, no worktree, cents instead of a session. An
  Agent with an Output Schema does the same at ten times the cost and time.
  Deletion test passes for extraction and summarisation steps; fails if those
  turn out rare in real nights. Measure after a month.
- `by: person` is a form in the Needs-you inbox rendered from the schema. The
  Gate's `note` and the Agent's `needs-input` resume prompt cover most of this
  today. Build only when a flow needs typed answers.
- Why one node and not three: the same argument as Decision. One seam, one
  inspector, one card in the transcript, and the engine's chooser dispatch is
  already written (`graph/nodes/choosers/`).

### 3.3 Tool: one MCP tool call — **Worth exploring**

The MCP leg of "flow + CLI + MCP". A Command node runs a CLI; a Tool node calls
one tool of a Connection with arguments from templates and gets a typed result.

```jsonc
{ "type": "tool", "connection": "linear", "tool": "create_issue",
  "arguments": { "title": "{{review.data.title}}", "teamId": "{{team}}" } }
```

- Outcomes: `pass`, `fail` (`isError` or a transport error). Outputs: `data`
  (structured content when the tool returns it, else the text), `text`.
- Thin: `@modelcontextprotocol/sdk` is already a dependency of `agents`;
  Connections already hold the server definition and `${NAME}` secrets. The
  inspector lists the tools of the chosen Connection (`tools/list`) and draws
  the argument fields from the tool's input schema.
- Deletion test is honest: `gh`, `glab`, `acli` and `linear` CLIs exist, so a
  Command covers the trackers Night Shift targets first. Tool earns its place
  for services without a CLI, for typed results without parsing stdout, and
  because it turns every Connection into a deterministic step with no model in
  the loop. Worth exploring, not Strong, until a night needs it.
- Naming: "Tool" clashes with the CLI Tool on the Agents page. Candidates:
  "Tool" (node) next to "CLI tool" (program), or "Connection" as the node name.

### 3.4 Wait: time and the outside world — **Strong** for a night product

Nothing today can sleep or wait for the world. "Wait for CI" is a Command in a
retry loop with a Max, which burns steps and sleeps nowhere.

```jsonc
{ "type": "wait", "until": { "kind": "time", "at": "{{deploy_window}}" } }
{ "type": "wait", "until": { "kind": "duration", "minutes": 15 } }
{ "type": "wait", "until": { "kind": "command", "command": "gh pr checks {{pr}} --watch", "everyMinutes": 5 } }
{ "type": "wait", "until": { "kind": "signal", "name": "deploy-finished" } }
```

- Outcomes: `done`, `timeout` (`timeoutMinutes` from `nodeBase`). Outputs:
  `waited_minutes`, and for `command` the last `log_tail`.
- Thin: the engine already parks a Step with an Interrupt and a wake time
  (`wait__` nodes, `planWait`, the streak in state) and the scheduler already
  wakes threads. A Wait node is the first node whose *whole job* is that
  machinery. `signal` is one API route plus `nightshift signal <run> <name>` on
  the CLI, which is how webhooks and other systems reach a run.
- Deletion test passes: every alternative polls in a loop and spends Steps.

### 3.5 Command `output: "json"` — **Strong**, tiny

Not a node. A flag on Command that parses stdout as JSON into `data`, as the
For Each command source already does. Gives the CLI leg the value column.

## 4. Not nodes

| Idea | Why not |
| --- | --- |
| End / Return | A flow ends where an outcome has no edge; `ended` carries the label and the flow's `outputs` carry the values. |
| Join / Merge | There are no parallel branches to join. Edges converge on a node by themselves. Revisit with `each.parallel`. |
| Notify | A Command (`gh pr comment`, `slack` CLI) or a Tool. |
| HTTP request | A Command (`curl`) or a Tool. |
| Variable / Set | A Value node by rule. |
| Code | A Command with a script, or a Value node by rule. |
| Trigger | A property of a Schedule, not a node. A `signal` Wait is the in-run half. |
| Approve | A Gate. |
| Note / annotation | A canvas sticky, not a node: no Step, no outcome. Cheap to add as a React Flow annotation if wanted. |
| Retry | An Edge with a Max. |

## 5. The resulting palette

Seven node types in four groups. Each is one seam; `by` and `each` switch who
fills it, never what it is.

| Group | Node | Label | Value |
| --- | --- | --- | --- |
| Do | Agent | its outcomes | `data` |
| Do | Command | exit code | `log_tail`, `data` with `output: "json"` |
| Do | Tool | `pass` / `fail` | `data` |
| Decide | Decision (`by` person / rule / model) | an option | `note` |
| Shape | Value (`by` person / rule / model) | `pass` / `fail` | `data` |
| Wait | Wait | `done` / `timeout` | `waited_minutes` |
| Compose | Call (`each` optional) | `pass` / `fail` or `done` / `halted` | outputs, `results` |

## 6. Order of work

1. Call (3.1) and Command `output: "json"` (3.5): one flow version bump, one
   migration, fewer files than today. Do first.
2. Value by rule (3.2): JSONata is in; one chooser, one inspector tab.
3. Wait with `duration`, `time` and `command` (3.4); `signal` once the CLI has
   a route for it.
4. Value by model (3.2), on the Decision's decider seam.
5. Tool (3.3) when a night needs a Connection without a CLI.
6. Value by person, `each.parallel`: when a real flow asks.
