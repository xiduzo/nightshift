# Variables

**Status, 2026-10-20:** built: engine, editor and run page (slices 1 to 3).
Decided with the developer: a flow's variables are its own (not shared with
the flows it calls), and a node writes them when its step ends. The open
questions of §11 were closed with the proposed defaults: the name stays
"Variable", writes apply in order, and flow outputs stay explicit
templates. Two changes from the design while building it: §4.3 and §5.1.

The question: how does a flow keep a named, typed value that any of its nodes
can read and change while it runs? Today a node reads only the inputs, `run`,
and the outputs of each node's latest visit.

## 1. Why

Three things a person cannot draw today without a shell or an agent:

- **Keep history across a loop.** `{{check.log_tail}}` is the output of the
  latest visit only (`RunState.nodes` keeps one entry per node). A rescue
  agent on its third try cannot see why the first two failed.
  With a variable: `failures ← $append(vars.failures, check.log_tail)`.
- **Read "whichever ran last".** `worker` and `rescue` both make a summary.
  A later node must pick one with two references and a rule. With a
  variable, both write `summary`, and the later node reads `{{vars.summary}}`.
- **Carry a value to the end.** A value made early (a pull request URL, a
  plan) is read many nodes later. Today the reference couples the late node to
  the early node's id and output shape. A variable is a named seam between
  them.

## 2. Decisions

| Question | Decision | Why |
| --- | --- | --- |
| Scope | Per flow invocation. A run's top-level flow has its own variables. Each Call and each Item of a Call with `each` starts fresh. | A flow is a function (`schema.ts`). Data crosses into a flow through Inputs and out through Outputs. A body flow that read its caller's variables would work under one caller only. Items would see each other's writes. |
| How a node writes | Declarative "Set variables" on the node, evaluated once when its step ends. | Deterministic, and atomic with `StepEnded`. The writes show in the editor, the canvas and the log. No harness change. |
| Writes in the middle of a step | Not now. See §9. | Writes that are not tied to the step's end make resume and replay harder. |
| A new node kind | No. A Value node by rule with "Set variables" is the "compute and assign" node. | The deletion test in `foundational-nodes.md`: an assign node would add a node to every write, and the Value node already makes values. |

## 3. The flow file

A new top-level list next to `inputs` and `outputs`, and a `set` list on
`nodeBase`. Both default to `[]`, so a version 4 file reads unchanged.

```json
{
  "version": 5,
  "inputs":  [{ "name": "item", "type": "json" }],
  "variables": [
    { "name": "failures", "type": "json",   "initial": "[]",
      "description": "Why each check failed, oldest first." },
    { "name": "summary",  "type": "text" },
    { "name": "issue",    "type": "number", "initial": "{{item.number}}" }
  ],
  "nodes": [
    { "id": "check", "type": "command", "command": "bun test",
      "set": [
        { "variable": "failures", "on": ["fail"],
          "expression": "$append(vars.failures, check.log_tail)" }
      ] },
    { "id": "rescue", "type": "agent", "prompt": "Earlier failures: {{vars.failures}} …",
      "set": [{ "variable": "summary", "value": "{{rescue.summary}}" }] }
  ]
}
```

### 3.1 A variable

| Field | Meaning |
| --- | --- |
| `name` | `nameSchema`. Unique among variables. Not reserved. |
| `type` | `text`, `number`, `boolean`, or `json`. The four field types of the Output Schema editor (it also has choice and list, which are `json` with a `schema` here). |
| `schema` | `json` only, optional. A JSON Schema, built with the Output Schema field editor. The engine checks every write against it (`graph/output-schema.ts`, `dataProblem`). |
| `initial` | Optional template. Rendered once when the flow starts, after its inputs are bound, with `renderValue` (one reference keeps its JSON value). It can read inputs and `run`, never a node (no node ran yet). Unset: `null`. |
| `description` | Optional. Shown in the variable picker and on the run page. |

**Coercion** is the Tool node's rule for arguments: one reference keeps its
JSON value. Text is read as the variable's type: `"3"` as a number, `"true"`
as a boolean, `"[]"` as JSON. A value that does not fit the type is not
written (§4.3).

### 3.2 A write

```ts
const variableWriteSchema = z.object({
  variable: nameSchema,
  /** A template: `{{deliver.data.url}}`. One reference keeps its JSON value. */
  value: z.string().optional(),
  /** A JSONata expression over the run's values, `vars` included: `vars.tries + 1`. */
  expression: z.string().optional(),
  /** The outcomes that write. Unset: every outcome the step routes on. */
  on: z.array(outcomeSchema).optional(),
}); // exactly one of value and expression (refine)
```

- `value` uses the same syntax as every other assignment in a flow: flow
  outputs, Call input bindings and Tool arguments are all templates.
- `expression` is for arithmetic and lists. It uses the same JSONata that
  Rules and Value-by-rule use (`rule.ts`).
- The node's own id reads the step that just ended: `{{check.log_tail}}` on
  `check` is this visit's tail.
- A node's writes apply in order, and each write sees the writes before it.
- A step that ends `stopped`, `error` or `interrupted` writes nothing. Those
  outcomes park the run and never route.

## 4. Engine

### 4.1 Reading

- `TemplateContext` gains `vars: Record<string, JsonValue>`.
- `lookupRef` reads `vars` like `run`: `{{vars.failures.0}}`.
- `ruleContext` adds `vars`, so a Decision option can read
  `vars.tries >= 3`, and so can a Value by rule.
- `renderCommand` needs no change. `{{vars.issue}}` becomes `NS_VARS_ISSUE`.
- `reservedNames` becomes `["run", "vars"]`.
- `templateContext()` in `graph/context.ts` passes `state.vars`.

### 4.2 State

A new channel in `RunState` (`graph/state.ts`):

```ts
/** The flow's variables, by name: the initial values, then each write. */
vars: mergedRecord<JsonValue>(),
```

Per-flow scope falls out of the graph as it is. A body is its own subgraph
with its own state (`nodes/body.ts`), and each invoke of a Call node is a new
task namespace. So a body's `vars` start from its own declaration, and the
caller's are not visible.

The initial values go into the state where the inputs go in. For the
top-level flow, that is where the runner starts the thread. For a body, that
is `runBody`, next to the bound inputs.

### 4.3 Writing

Writes are applied in the step runner's `end()` (`graph/step-runner.ts`),
**before** `StepEnded` is appended:

1. Leave out the writes whose `on` does not hold the outcome.
2. Evaluate each write (`renderValue` or `evaluateRule`) against the template
   context, with the node's outputs set to this step's outputs.
3. Coerce the result to the type, and check it against `schema`.
4. All writes fit: `StepEnded.payload.variables` holds them (only the
   variables that changed), and `route()` merges them into `vars`.
5. A write does not fit: the step ends `error`, so the run parks as failed
   and a person can fix the flow and resume. The `StepEnded` error is for a
   person, for example: `Could not set "tries": a number is needed, and the
   value is "abc".`

Writes travel inside `StepEnded`, not in an event of their own. A crash
cannot leave a step ended with its writes lost, or the reverse.

Initial values go into the log as `VariablesSet { values, scope }` with no
step. A graph node `vars__init` writes it before the first step, and
`compile.ts` adds that node only to a flow that has variables, so the graph
of every other flow is the same as before. An initial value that does not
fit parks the run as failed at the start node, before its step.

The run page reads the history as `RunDetail.variables`
(`deriveVariableChanges`): each value, its scope, and the step that wrote
it.

### 4.4 Re-entry and replay

- `reentryUpdate` (`resume-point.ts`) gains `vars: deriveVariables(events,
  scopeKey)`: the `VariablesSet` of the scope, then each `StepEnded.variables`
  in order. A thread without a checkpoint resumes with the right values.
- The result of an expression is logged, never evaluated again. JSONata
  functions like `$now()` and `$random()` stay safe for resume and Hand-off.
- The values are in the Checkpoint, so the Archive and a Hand-off carry them
  with no extra work. A Run Bundle carries them in its events.

### 4.5 Limits

- A variable's value, as JSON, is at most 256 KB. A larger write fails like a
  type mismatch. `$append` in a long retry loop is the case to guard against.
- Steps of one flow run one at a time (a Call with `each` too: no
  `each.parallel` yet). Two writes never race. When `each.parallel` comes,
  per-flow scope keeps each Item's variables separate.

## 5. Validation (`validate.ts`)

| Issue | Severity |
| --- | --- |
| A variable name that is not valid, is used twice, is reserved, or is also an input or a node id | error |
| `{{vars.x}}` or `vars.x` in a rule, where the flow has no variable `x` | error |
| A path into a variable that is not `json` (`{{vars.tries.foo}}`) | error |
| A write to a variable the flow does not have | error |
| A write with both or neither of `value` and `expression` | error |
| An `expression` that is not valid JSONata | error |
| An `on` outcome the node cannot end with | error |
| An `initial` that reads a node | error |
| `${NAME}` in a write or an `initial`: the value lands in the log and in Run Bundles | error |
| An `initial` text that does not fit the type (`"abc"` for a number) | error |
| A variable that no node writes and no template reads | warning |
| A `value` that is one reference to a typed source of another type (a `number` from a field the Output Schema calls text) | warning, later slice |

The existing check for template references (`validate.ts`, around
`templateRefs`) grows a branch for `vars`.

### 5.1 Migration

`FLOW_VERSION` goes to 5. The migration from 4 changes the version only:
an older Night Shift then refuses the file instead of dropping its
variables. A node or an input named `vars` is a validation error, not a
rename. No flow in `examples/` uses the name.

## 6. Editor

Built from shadcn components only (`AGENTS.md`, `docs/shadcn.md`).

- **Variables section** in the flow's settings, next to Inputs and Outputs.
  One `Item` per variable: name (`Input`), type (`Select`), initial value
  (`TemplateField`, one line), and description. A `json` variable opens the
  Output Schema field builder. In the editor header, a `Badge` per variable
  next to the inputs: `tries : number`.
- **Set variables section** on every node panel, under its outcomes. One row
  per write: the variable (`Select`), Template or Expression (`ToggleGroup`),
  the value (`TemplateField`), and the outcomes (`ToggleGroup` with multiple
  selection, unset means all).
- **Variable picker.** `templateVariables()` in `features/flows/flow-draft.ts` adds a
  `vars` group after the inputs, with the type as the description. A `json`
  variable leaves the cursor before `}}` for a path, as `data` does now.
- **Canvas.** A small `Badge` on a node that writes: `sets 2`. The tooltip
  names the variables.

Copy, following the UI copy rules:

| Place | Text |
| --- | --- |
| Variables section description | Values the flow keeps while it runs. Each step can read them and change them. |
| Empty state | No variables yet. Add one to keep a value between steps, such as each failed check. |
| Initial value hint | The value when the flow starts. Use an input, for example `{{item.number}}`. |
| Set variables hint | Changes these variables when the step ends. |
| Expression hint | A JSONata expression, for example `vars.tries + 1`. |
| Write error (run) | Could not set "tries": a number is needed, and the value is "abc". |

## 7. Run page

A **Variables** `Card` on the run page, per flow scope. A `Table` lists each
variable, its value now, and the step that set it last (a link to that
step). A row opens a `Sheet` with each value the variable had, the step that
wrote it, and when. All of it is derived from the Event Log (`read/read-model.ts`),
never from a Checkpoint.

## 8. Glossary

New entries, and one change:

| Term | Meaning |
| --- | --- |
| Variable | A named, typed value a Flow keeps while it runs, like a local variable of a function. Declared on the Flow with an initial value. Read as `{{vars.name}}`. Changed by a Node's writes when its Step ends. Each Flow invocation has its own: the Run's top-level Flow, each Call, each Item. |
| Variable write | One entry in a Node's `set`: a Variable, a template or an expression, and the Outcomes it writes on. Applied once, when the Step ends, and logged in `StepEnded`. |
| Template Variable (changed) | … a Node output, an Input, a Variable (`{{vars.tries}}`), or a Run field … |

## 9. Later

- **Agent writes in the middle of a session.** A `set_variable` tool over the
  tool bridge, next to `report_step`. To keep §4.3 true, the tool buffers the
  writes and the step runner applies them at the step's end, so the step stays
  the unit of change. Until then, an agent writes through its Step Report
  `data`, and the node maps that to a variable.
- **Value by person.** A form in the Needs-you inbox that writes a variable.
- **Static type checks** from Output Schemas (the last row of §5).
- **Number and boolean Inputs**, so inputs and variables have the same types.

## 9a. Kept variables (built 2026-10-26)

`"keep": "project"` on a variable keeps its value between runs
(`node-review-2026-10.md` §5.2): memory such as a skip list, without a
file next to `.git`.

- **Start.** `vars__init` reads the flow's kept values and passes them to
  `initialVariables`. A kept variable with a value starts from it; one
  without, or with a value that no longer fits its type or schema, starts
  from `initial`. `VariablesSet.kept` names the ones that came from an
  earlier run, and the run page says "Kept from an earlier run".
- **Write.** Each write of a kept variable saves it in the `kept_variable`
  table (`@nightshift/engine` `variables/`), in the batch of the step's
  `StepEnded`: the write and the saved value land together. The last write
  to end wins, also across parallel branches and runs at once.
- **Key.** Project, flow file name and variable name. A called flow keeps
  its own, by its own name. A quick run has no flow file and keeps nothing.
- **Where.** The table is in the run history database of the computer that
  walks the run (the app data dir). The exchange does not copy it, so each
  Replica keeps its own values. A resume reads the run's events, never the
  table.
- **Editor.** A "Keep between runs" switch on each variable. When it is
  on, the row shows the kept value and a Reset button (`flows.kept`,
  `flows.resetKept`). A reset removes the row: the next run starts from
  `initial`.
- **Validation.** A kept variable that a template reads but no node sets is
  a warning: it keeps nothing.

## 10. Slices

1. **Engine.** Schema and migration, validator, `vars` in templates and rules,
   initial values, writes in `end()`, the `vars` channel, `VariablesSet` and
   `StepEnded.variables`, re-entry. Tests: a loop that keeps failures, a body
   that does not see the caller's variables, Items that start fresh, a
   write that does not fit and parks the run, re-entry with no Checkpoint.
2. **Editor.** The Variables section, the Set variables section, the picker
   group, the canvas badge, and the issues in the Issues panel.
3. **Run page.** The Variables card and its history.

## 11. Open questions

- **The name.** "Variable" is close to "Template Variable", the name the
  picker uses for any reference. Keep it, and say that a Template Variable can
  read a Variable? Or call these "Run values" and write `{{vars.x}}` anyway?
- **Order of writes.** In order, each write seeing the one before (proposed),
  or all against the values before the step, like SQL `UPDATE`?
- **Flow outputs.** Should an output default to the variable of the same
  name, so `outputs: [{ "name": "summary" }]` returns `{{vars.summary}}`
  without a template?
