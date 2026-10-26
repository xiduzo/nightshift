---
name: nightshift-flows
description: Write, change and check Night Shift flows (the `.nightshift/flows/<name>.json` files of a project). Use when the person asks to build, draw, fix or explain a Night Shift flow, a node, an edge, a loop, a Gate or a Subflow, or when you edit a file in `.nightshift/flows/`.
---

# Night Shift flows

Night Shift runs flows: graphs of steps (agents, shell commands, tools, decisions) that work through the night on a project. This skill tells you how to write a flow that Night Shift accepts.

## How to work

1. **Read before you write.** Read the flows the project has (`.nightshift/flows/*.json`, or `list_flows` and `get_flow` of the `nightshift` MCP server). Reuse a flow with a Subflow (`call`) node instead of copying its steps.
2. **Look names up, do not invent them.** A node may name an Agent Profile, a connection, a CLI tool, a skill or another flow. Use only ones that exist: `list_profiles`, `list_tools` and `list_skills` of the `nightshift` MCP server, or ask the person.
3. **Draw the whole flow.** Write the complete JSON document, not a patch. Keep the ids of nodes and edges you do not change, so the person sees a small diff.
4. **Check it.** Send it to `check_flow` and fix every error. A warning can stay when it is on purpose (an outcome that ends the run). Without the MCP server, follow the checklist below.
5. **Hand it over.** In the flow editor, `propose_flow` shows it to the person, who applies or discards it. In a terminal, `save_flow` saves it. Never save over a flow the person did not ask you to change.

Ask the person when the goal is not clear: what starts the flow, what it must make, and where a person must approve.

In the flow editor, `get_draft` gives the flow as the person has it now, saved or not: base every change on it. To fix a flow after a failed run, call `get_run` first (the run's status, its steps and the end of the failed step's transcript), explain what went wrong, then propose the change that prevents it.

In a terminal, the `nightshift` MCP server (`nightshift mcp`) has these tools. Night Shift must run on this computer.

- `list_projects`: the projects, with the one of your folder marked `current`. Every other tool works in that project, or in the one you name in `project`.
- `list_flows`, `get_flow`, `list_profiles`, `list_tools`, `list_skills`, `check_flow`: as in the editor. Give `check_flow` the `name` you will save under.
- `save_flow` (`name`, `flow`): checks the flow and saves it. A flow with errors is refused.
- `start_run` (`flow`, `inputs`): starts a saved flow on this computer, and gives the link where the person follows it.
- `list_runs`, then `get_run` (`run`): what a run did, and where it failed.

<!-- Generated from flowAuthoringGuide() in packages/flows. Do not edit below this line. -->

# Writing Night Shift flows

A flow is a directed graph of nodes and edges, saved as `.nightshift/flows/<name>.json` in the project. A run starts at `start`, runs one node (a step), and follows the edge for the outcome that step ended with. A run ends when no edge leaves on that outcome. A flow is a function: it takes `inputs` and returns `outputs`. Write version 6. The model never changes the graph at run time.

## The file

`{ version: 6, description?, inputs, outputs, variables?, start, nodes, edges, sections?, policy? }`

- `inputs`: `{ name, type: "text" | "json", label?, description?, default?, required? }`. A `json` input takes a path: `{{item.title}}`.
- `outputs`: `{ name, value, description? }`. `value` is a template, rendered when the flow ends.
- `variables`: `{ name, type, initial?, schema?, description?, keep? }`, `type` one of `text`, `number`, `boolean`, `json`.
- `policy`: optional. `maxSteps` caps the steps of a run.
- `sections`: frames in the editor only, see below.

Names (node ids, inputs, variables): lowercase letters, digits and `_`, starting with a letter, at most 40 characters. Node ids and inputs share one namespace. Do not use `run`, `vars`. Outcomes and option names: lowercase letters, digits and `-`. Do not use `error`, `stopped`, `interrupted`, `waiting`: those are the engine's.

## Nodes

The node types: `agent`, `command`, `decision`, `call`, `value`, `wait`, `tool`, `end`. Every node has `id`, `type`, `position: { x, y }`, and optional `label` (shown in the editor), `timeoutMinutes` and `set` (variable writes). Lay the nodes out left to right, about 300 apart on x, and put a loop's way back below the main line.

### agent

A coding-agent session. `prompt` (template) or `skill` (runs `/<skill> <prompt>`). Name a `profile` (an Agent Profile of this computer), or set `harness` (claude-code, opencode, codex, grok-build, copilot, gemini, cursor, pi, or `acp:<slug>`), `model` and `permissionMode` (default, acceptEdits, auto, bypassPermissions, plan) yourself. A profile is better. Optional: `effort`, `session` (`fresh`, or `resume` to continue its last session on a later visit), `clis` (programs it may run, for example `gh`), `connections`, `idleMinutes`, `output` (a JSON Schema for an object: the agent must report `data` that matches it), `outcomes` (its own outcomes, each `{ name, description }`; replaces the default ones), `ask: "person"`. With `ask: "person"`, an agent that needs input asks a person in a Gate and takes no edge: "answer" sends the person's note to the same session, "stop" ends the step `fail`. Do not draw a `needs-input` edge then, and do not build that loop with a Gate yourself.

Outcomes: `pass`, `fail`, `needs-input` unless it lists its own. Outputs: `outcome`, `output`, `summary`, `data`, `note`, `visit`, `session_id`.

`{"id":"build","type":"agent","position":{"x":0,"y":0},"profile":"worker","prompt":"Build {{task}}. Earlier failures: {{vars.failures}}","output":{"type":"object","properties":{"files":{"type":"array","items":{"type":"string"}}}}}`

### command

A shell command in the project. Its output is the log. To hand on data, it writes JSON to the file named by `$NS_OUTPUT`, which becomes `data`: `echo '{"count": 3}' > "$NS_OUTPUT"`. Data with an `outcome` that names one of its exits ends the step on that exit, whatever the exit code; else the exit code picks the outcome. `exits` lists `{ name, code }`; an exit with `"code": "data"` is picked by the data only; one exit without `code` catches every other code and goes last. Without `exits`: `pass` on 0, `fail` on any other code. `output: "json"` reads the JSON printed on stdout instead, when `$NS_OUTPUT` stays empty. `secrets` names secrets that reach the command as environment variables. A template value reaches the shell as an environment variable, never as shell text, so quote it: `echo "{{build.summary}}"`.

Outcomes: its exits (`pass`, `fail` without `exits`). Outputs: `outcome`, `exit_code`, `log_tail`, `data`, `visit`.

`{"id":"check","type":"command","position":{"x":0,"y":0},"command":"bun test","exits":[{"name":"pass","code":0},{"name":"fail","description":"Any other exit code."}]}`

### decision

Picks one of its `options` (each `{ name, description }`); the option is the outcome. `by`: `person`, `rule`, `model`. `person` is a Gate: `prompt` is the question, and the run waits for the answer. A Gate may have `deadline: { at: "07:00", choose: "keep" }` (or `minutes` instead of `at`, counted from when it opens): when nobody answered by then, it takes the option `choose`. `rule` is a Branch: each option but the last has `when`, a JSONata rule; the first that holds wins, the last option has no rule and is the default. `model`: a small model reads `prompt` and picks; `decider` (one of typesafe, openrouter, openai, ollaya, ollama) and `model` are optional and read only then.

Outcomes: its options. Outputs: `outcome`, `note`, `visit`.

`{"id":"approve","type":"decision","position":{"x":0,"y":0},"by":"person","prompt":"Open a pull request for {{task}}?","options":[{"name":"yes"},{"name":"no"}]}`

### call

Shown as Subflow. Runs another flow of the project (`flow`, its file name) with `inputs` bound to templates. With `each`, it runs the flow once per element of a list: `source` is `{ kind: "json", value }` or `{ kind: "command", command }` (prints a JSON array); the element goes to the input named by `as`. Without `each` its outputs are the called flow's outputs too. A called flow that ends at an End node ends the Call `pass` (`done`, `nothing-to-do`) or `fail` (`failed`); `ended` holds the End's status and `end_message` its message.

Outcomes: `pass`, `fail`, `stopped`; with `each`: `done`, `halted`, `stopped`. Outputs: `outcome`, `ended`, `end_message`, `visit`; with `each`: `outcome`, `done_count`, `failed_count`, `blocked_count`, `waiting_count`, `summary`, `results`, `visit`.

`{"id":"each_task","type":"call","position":{"x":0,"y":0},"flow":"build-task","inputs":{"check":"bun test"},"each":{"source":{"kind":"json","value":"{{plan.data.tasks}}"},"as":"item"}}`

### value

Makes `data` that matches `output` (a JSON Schema for an object). `by: "rule"` with `expression` (JSONata over the run's values), or `by: "model"` with `prompt` and optionally a `decider` that can make a value (openrouter, openai, ollama). Use it to compute or reshape a value, often with `set`.

Outcomes: `pass`, `fail`. Outputs: `outcome`, `data`, `note`, `visit`.

`{"id":"small","type":"value","position":{"x":0,"y":0},"by":"rule","output":{"type":"object","properties":{"tasks":{"type":"array"}}},"expression":"{ \"tasks\": plan.data.tasks[size = \"small\"] }"}`

### wait

Waits, then ends `done`. `until` is one of: `duration`, `time`, `command`, `signal` (`{ kind: "duration", minutes }`, `{ kind: "time", at: "07:00" }`, `{ kind: "command", command, everyMinutes }` until it exits 0, `{ kind: "signal", name, key? }`). `timeoutMinutes` ends it `timeout`. A signal comes from a person on the run page, or from a webhook schedule of the project: then `data` holds the webhook (`{{wait_ci.data.body.check_suite.conclusion}}`). With `key` (a template, for example `{{pr}}`), only a webhook whose signal key is that text wakes it.

Outcomes: `done`, `timeout`. Outputs: `outcome`, `waited_minutes`, `log_tail`, `data`, `visit`.

`{"id":"cool_down","type":"wait","position":{"x":0,"y":0},"until":{"kind":"duration","minutes":10}}`

### tool

Calls one tool of a connection (an MCP server of this computer), with no model. `connection`, `tool`, and `arguments` (a template per argument). `data` is the structured result.

Outcomes: `pass`, `fail`. Outputs: `outcome`, `data`, `text`, `visit`.

`{"id":"ticket","type":"tool","position":{"x":0,"y":0},"connection":"jira","tool":"getIssue","arguments":{"key":"{{issue}}"}}`

### end

Ends the run on purpose. `status`: `done`, `nothing-to-do`, `failed`. `message` (template) is one line for a person: the runs list and the notification show it. `nothing-to-do` is for a run that found no work: it is not a failure. `failed` fails the run on purpose. No edge leaves an End node.

Outcomes: none, the run ends here. Outputs: `outcome`, `message`, `visit`.

`{"id":"no_work","type":"end","position":{"x":0,"y":0},"status":"nothing-to-do","message":"No open issues for {{label}}"}`

## Edges, outcomes and loops

An edge is `{ id, from, outcome, to, max? }`. It leaves `from` when its step ends with `outcome`. Use ids such as `check-fail-fix`. Each outcome a node can end with needs an edge, else the run ends there: on `fail` or `needs-input` that ends it as failed. To end the run on purpose, lead the edge to an End node: it says why the run ended (`nothing-to-do`, `failed`) in one line.

Every loop needs at least one edge with `max`: how often a run may take that edge. A Gate in a loop needs one too. Put `max` on the edge that goes back (`check-fail-fix`, max 3). When every edge for an outcome reached its max, the run fails there. Several edges may leave on one outcome: the run takes the first, in file order, that has not reached its max (fix three times, then ask a person). Every node must be reachable from `start`.

## Templates

Prompts, commands, arguments, input bindings, outputs and variable values are templates: `{{name}}` or `{{name.path}}`.

- `{{task}}`: an input, by its name (a `json` input takes a path).
- `{{check.log_tail}}`: an output field of a node, by its id. A node that has not run yet gives "". `data` and `results` take a path: `{{plan.data.tasks.0.title}}`.
- `{{vars.failures}}`: a variable.
- `{{run.branch}}`: a field of the run: `branch`, `base_branch`, `index`, `worktree`, `base_ref`, `flow`.

A template that is only one reference keeps its JSON value (an array stays an array). The validator checks every reference: read only inputs, variables, run fields and output fields that exist.

Rules (a Decision's `when`, a Value's `expression`, a write's `expression`) are JSONata over the same values, without braces: `check.exit_code = 0 and vars.tries < 3`.

## Variables

A variable is a named, typed value the flow keeps while it runs. Declare it in `variables`. `initial` is a template over the inputs and `run` only. Read it as `{{vars.name}}`. A node changes it with `set`, a list of `{ variable, value | expression, on? }`: exactly one of `value` (a template) or `expression` (JSONata), and `on` lists the outcomes that write (unset: every outcome). Writes apply in order when the step ends. The node's own id reads the step that just ended. Each flow, each Subflow and each element of a Subflow with `each` has its own variables. A value that does not fit the type ends the step with an error.

`"keep": "project"` keeps a variable between runs: memory for the next run, such as the issues a flow skipped. A run starts from the value the last write of this flow left in this project, else from `initial`. Each write saves it. A Subflow keeps its own, by its flow name. A kept value that no longer fits the type starts from `initial`. A person can reset a kept value on the flow's page. Check for duplicates with JSONata over the list: `item.number in vars.skipped`.

## Schedules and webhooks

A schedule in `.nightshift/schedules.json` starts a flow at set times (`cron`) or when a webhook arrives (`webhook: { secret: "${NAME}", when? }`, `when` a JSONata rule over `event`). A webhook schedule's `inputs` are templates over the event: `{{event.body.pull_request.number}}`, `{{event.headers.x-github-event}}`. It can also send a signal to the project's runs (`signal: { name, key? }`, `key` JSONata over `event`): a Wait on that name wakes, with the event as its `data`. Wait for CI with a signal and a `timeoutMinutes`, not with a command that polls.

## Sections

`{ id, label, color?, description?, nodes, sections? }`: a box around nodes, for the editor only. `sections` lists the ids of the Sections inside it. A node is in one Section at most: the lowest one that holds it. A Section is inside one other at most. All its nodes, also those of the Sections inside, should form one connected part that the flow enters at one node. Colours: `gray`, `red`, `orange`, `yellow`, `green`, `teal`, `blue`, `violet`, `pink`. Outcome colours: `red`, `orange`, `amber`, `yellow`, `lime`, `green`, `teal`, `cyan`, `sky`, `blue`, `indigo`, `violet`, `pink`, `gray`.

## Checklist

- `version` is 6, `start` names a node, every edge connects known nodes on an outcome its source can end with.
- Every Agent node has a profile, or a harness, model and permission mode. Use only profiles, connections, CLI tools and flows that exist: look them up, do not invent names.
- Every loop has an edge with `max`.
- Prefer a Command node to an Agent node when a shell command can do the job: it is fast, free and repeatable. Ask a person with a Gate before a step that others see (a pull request, a message).

## Example: build, test, fix, ask

```json
{
 "version": 6,
 "description": "Builds a task, runs the tests, fixes failures, then asks.",
 "inputs": [
  {
   "name": "task",
   "type": "text",
   "required": true
  }
 ],
 "outputs": [
  {
   "name": "summary",
   "value": "{{vars.summary}}"
  }
 ],
 "variables": [
  {
   "name": "failures",
   "type": "json",
   "initial": "[]"
  },
  {
   "name": "summary",
   "type": "text"
  }
 ],
 "start": "build",
 "nodes": [
  {
   "id": "build",
   "type": "agent",
   "position": {
    "x": 0,
    "y": 0
   },
   "profile": "worker",
   "prompt": "Implement {{task}}. Report what you changed.",
   "set": [
    {
     "variable": "summary",
     "value": "{{build.summary}}"
    }
   ]
  },
  {
   "id": "check",
   "type": "command",
   "position": {
    "x": 300,
    "y": 0
   },
   "command": "bun test",
   "set": [
    {
     "variable": "failures",
     "on": [
      "fail"
     ],
     "expression": "$append(vars.failures, check.log_tail)"
    }
   ]
  },
  {
   "id": "fix",
   "type": "agent",
   "position": {
    "x": 300,
    "y": 200
   },
   "profile": "worker",
   "prompt": "The tests fail:\n{{check.log_tail}}\nEarlier failures: {{vars.failures}}\nFix the code, not the tests.",
   "set": [
    {
     "variable": "summary",
     "value": "{{fix.summary}}"
    }
   ]
  },
  {
   "id": "approve",
   "type": "decision",
   "position": {
    "x": 600,
    "y": 0
   },
   "by": "person",
   "prompt": "The tests pass for {{task}}. Open a pull request?",
   "options": [
    {
     "name": "open",
     "description": "Open the pull request."
    },
    {
     "name": "stop",
     "description": "Keep the branch, do nothing."
    }
   ]
  },
  {
   "id": "open_pr",
   "type": "command",
   "position": {
    "x": 900,
    "y": 0
   },
   "command": "gh pr create --fill --body \"{{vars.summary}}\""
  }
 ],
 "edges": [
  {
   "id": "build-pass-check",
   "from": "build",
   "outcome": "pass",
   "to": "check"
  },
  {
   "id": "check-pass-approve",
   "from": "check",
   "outcome": "pass",
   "to": "approve"
  },
  {
   "id": "check-fail-fix",
   "from": "check",
   "outcome": "fail",
   "to": "fix",
   "max": 3
  },
  {
   "id": "fix-pass-check",
   "from": "fix",
   "outcome": "pass",
   "to": "check"
  },
  {
   "id": "approve-open-open_pr",
   "from": "approve",
   "outcome": "open",
   "to": "open_pr"
  }
 ]
}
```

## Example: plan, then build each task

This one calls the flow `build-task`, which takes an input `item`.

```json
{
 "version": 6,
 "description": "Plans a feature, then builds each task in its own branch.",
 "inputs": [
  {
   "name": "feature",
   "type": "text",
   "required": true
  }
 ],
 "outputs": [],
 "start": "plan",
 "nodes": [
  {
   "id": "plan",
   "type": "agent",
   "position": {
    "x": 0,
    "y": 0
   },
   "profile": "planner",
   "prompt": "Split {{feature}} into small tasks. Change no files.",
   "outcomes": [
    {
     "name": "planned",
     "description": "The tasks are ready."
    },
    {
     "name": "unclear",
     "description": "The feature needs more detail."
    }
   ],
   "output": {
    "type": "object",
    "required": [
     "tasks"
    ],
    "properties": {
     "tasks": {
      "type": "array",
      "items": {
       "type": "object",
       "required": [
        "id",
        "title",
        "details"
       ],
       "properties": {
        "id": {
         "type": "string"
        },
        "title": {
         "type": "string"
        },
        "details": {
         "type": "string"
        }
       }
      }
     }
    }
   }
  },
  {
   "id": "build_all",
   "type": "call",
   "position": {
    "x": 300,
    "y": 0
   },
   "flow": "build-task",
   "inputs": {},
   "each": {
    "source": {
     "kind": "json",
     "value": "{{plan.data.tasks}}"
    },
    "as": "item"
   }
  },
  {
   "id": "all_done",
   "type": "decision",
   "position": {
    "x": 600,
    "y": 0
   },
   "by": "rule",
   "prompt": "Did every task finish?",
   "options": [
    {
     "name": "clean",
     "when": "build_all.failed_count = 0"
    },
    {
     "name": "failures"
    }
   ]
  },
  {
   "id": "report",
   "type": "agent",
   "position": {
    "x": 900,
    "y": 0
   },
   "profile": "worker",
   "prompt": "These tasks failed:\n{{build_all.summary}}\nWrite a short report for the team."
  }
 ],
 "edges": [
  {
   "id": "plan-planned-build_all",
   "from": "plan",
   "outcome": "planned",
   "to": "build_all"
  },
  {
   "id": "build_all-done-all_done",
   "from": "build_all",
   "outcome": "done",
   "to": "all_done"
  },
  {
   "id": "all_done-failures-report",
   "from": "all_done",
   "outcome": "failures",
   "to": "report"
  }
 ],
 "sections": [
  {
   "id": "work",
   "label": "Build",
   "color": "blue",
   "nodes": [
    "build_all",
    "all_done"
   ]
  }
 ]
}
```
