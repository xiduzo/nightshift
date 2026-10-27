# rpgdotexe: the night as flows

These three flows rebuild `tools/night-shift/night-shift.py` of the rpgdotexe repo as Night Shift flows. They build the Features and the Traces of one Epic while nobody is present, and leave a stack of pull requests for the morning.

Night Shift knows nothing of Epics, Features, or Traces. A flow is a function with inputs and outputs, and these three call each other: `night` takes the Epic number as its input `epic`. Its Call node reads the Epic's sub-issues with `gh` and runs `feature` once per Feature, with the issue as the input `item`. `feature` does the same for its Traces and `trace`. A flow reads its input with a path (`{{item.number}}`, `{{item.parent.number}}`), the engine's facts about the element from `run` (`{{run.branch}}`, `{{run.base_branch}}`), and what a called flow returned from the Call node's `results`. The files are format version 4.

| Flow | Inputs | Outputs | Does |
| --- | --- | --- | --- |
| `night.json` | `epic` (text, required): the Epic's issue number. The run starts here. | `pull_requests`, `report` | Runs `feature` for each Feature of the Epic (label `feature`), blockers first. Halts the night when a Feature ends on `halt`. Then links the pull requests into a stack and writes `.build/night/STATUS.md`, also after the stop time (the edge on `stopped`). |
| `feature.json` | `item` (json, required): the Feature issue. | `prs`, `tune_pr`, `checkpoint`, `ci`, `steering` | Runs `trace` for each Trace of the Feature (label `trace`, not `implemented`), blockers first, each on its own branch on top of the last. Then the checkpoint: a rule checks that every Trace is built, the validator verifies and tunes on a `tune/` branch, the night waits for CI, the orchestrator writes steering notes, and a rule continues or halts the night. |
| `trace.json` | `item` (json, required): the Trace issue. | `pr`, `scenarios`, `tries` | The worker builds the Trace, the check runs, a failed check goes back to a fresh worker (3 tries), then the orchestrator rescues it. A Trace that passes gets a pull request on the stack and the label `implemented`. A Trace that still fails ends as failed, so the Traces that wait on it are blocked. |

## The agent profiles

The script has three roles. Each is an Agent Profile on the Agents page, and the Agent nodes name it in `profile`. A node sets nothing else, so the model, the effort and the permission mode of a role change in one place, and the next run picks the change up. `profiles.json` holds the three, in the shape the Agents page saves.

| Profile | Harness | Model | Effort | Permission mode | CLI tools | Used by |
| --- | --- | --- | --- | --- | --- | --- |
| `worker` | Claude Code | `sonnet` | high | auto | `gh` | `trace` → `worker` |
| `validator` | Claude Code | `sonnet` | high | auto | `gh` | `feature` → `validate` |
| `orchestrator` | Claude Code | `opus` | high | auto | `gh` | `trace` → `rescue`, `feature` → `steer` |

The script's default worker is a local OpenCode model. Night Shift has only the Claude Code harness wired up for the night, so the worker runs on Sonnet, the setup the script's README gives as its example. To try another harness or model for one role, edit that profile; the flows stay as they are.

The agents get the script's prompts, not the `wtf.*` skills: those skills ask the person questions, and nobody is awake. The four prompts end with the same block of repository rules; change it in all four.

## How to use it

1. On the Agents page, add the CLI tool `gh` (under Tools), then the three profiles from `profiles.json`: `worker`, `validator` and `orchestrator`. Night Shift has no import for profiles yet, so add each one by hand with the values of the table.
2. Add your rpgdotexe clone as a project in Night Shift.
3. Save the three flows into the project. Night Shift keeps flows itself, so do not copy the files into the clone. Ask an agent that has the `nightshift` MCP server (`claude mcp add nightshift -- nightshift mcp`) to save each file in `examples/rpgdotexe/.nightshift/flows/` with `save_flow`. The editor gets a JSON import for this (planned, [ADR 2](../../docs/adr/0002-flows-are-night-shift-data.md)). A flow that names a profile or a CLI tool the daemon does not have refuses to start, and the editor lists it as an issue. Later each Agent node names a profile and its computer, so you pick "worker on <your computer>" in the editor (planned, [ADR 3](../../docs/adr/0003-a-profile-belongs-to-one-device.md)).
4. Run the flow `night`: the start dialog asks for the Epic number (the input `epic`, like `night-shift.py <epic>`) and a stop time. At the stop time the night starts no new work. The Trace that was running ends as failed, and the night still links the stack and writes the report. The next run continues, because a Trace with the label `implemented` counts as done. A usage limit that resets after the stop time ends the night at once.
5. In the morning, read the stack of pull requests, `.build/night/STATUS.md` in the run's worktree, and the comment of the checkpoint on each Feature.

The flows call `python3 tools/night-shift/night-shift.py gate` (the check) and import two helpers from that file. Keep the script in the repo until the check moves somewhere else. Linking the stack needs the `gh stack` extension (`gh extension install github/gh-stack`); without it, the night report prints the command to run by hand.

## Which node does what

The seven node types, and where the night uses them:

| Node | Where | Why this node |
| --- | --- | --- |
| Agent | `worker`, `rescue`, `validate`, `steer` | A session on a harness. `validate` and `steer` have an output schema, so their findings are data (`{{validate.data.summary}}`, `{{steer.data.sound_base}}`), not a file the next step parses. |
| Command | the check, the format, the branches, the pull requests, the labels, the report | Everything `gh`, `git` and `python3` do. `prepare`, `deliver` and `deliver_tune` print JSON (`"output": "json"`), so later nodes read `{{prepare.data.scenarios}}` and `{{deliver.data.url}}`. |
| Decision by rule | `built`, `verdict` | A choice over typed values, no model: `traces.failed_count > 0 or …` and `steer.data.sound_base = false`. The script's DECIDE step is the orchestrator's verdict read by a rule. |
| Value by rule | `scenarios`, `prs`, `stack` | A JSONata expression over the results of a Call node: the scenarios of all Traces of a Feature, the pull requests of a Feature, the pull requests of the night. Replaces the files the script passed between steps (`feature-scenarios.txt`). |
| Wait | `ci` | Sleeps until `gh pr checks` is green on every pull request of the Feature, polling every 5 minutes, 30 minutes at most. No step and no session while it sleeps. `timeout` is a fact for the orchestrator, not a halt. |
| Call | `features`, `traces` | One flow per element of a list, blockers first, with `each`. The night shares one branch across Features; the Traces of a Feature each get their own on top of the last. |
| Tool | none | `gh` covers GitHub, so no Connection is needed. A tracker without a CLI would be a Tool node with a Connection. |

Not used: a Decision by a person (nobody is awake), a Decision by a model (the inputs of both decisions are typed, so a rule reads them; a Decision on Jev is the drop-in when the verdict should come from the reports instead), and a Value by a model (the Trace's scenarios come from the script's own parser, deterministically).

## Script step → node

| Script (`night-shift.py`) | Flow node |
| --- | --- |
| `fetch_plan`, `blockers_first`, Features first | `night` → `features` (Call with `each`, a `gh api graphql` command: label `feature`) |
| Traces of a Feature, `next_action`, a blocked Trace skips its dependents | `feature` → `traces` (Call with `each`, a `gh api graphql` command: label `trace`, done on `implemented`, not `draft`; `branch: per-item`) |
| `build_trace`: branch, `write_context` (`context.json`, `TRACE.md`, `FEATURE.md`) | `trace` → `prepare` (the engine makes the branch; the node prints the base and the scenarios as JSON) |
| `worker_prompt` + `RULES` + `trace_task` / `fix_task`, a new session each try | `trace` → `worker` (profile `worker`, `session: fresh`, 90 min, idle 30) |
| `format_swift` | `trace` → `format` |
| `loop_gate` (loose changes, no commit, protected files) + `gate` | `trace` → `check` |
| `--attempts 3` | edge `check` → `worker` on `fail`, `max: 2` (3 tries in all) |
| `rescue_prompt` on the orchestrator | `trace` → `rescue` (profile `orchestrator`, 75 min) |
| rescue 2: `fix_prompt`, resuming the rescue session | edge `recheck` → `rescue` on `fail`, `max: 1`, `session: resume` |
| `block_trace` (commit the loose work) | `trace` → `blocked`, which ends as `fail` |
| `deliver` + `pr_body` + `label(..., "implemented")` | `trace` → `deliver` (prints the pull request as JSON; the flow returns it as `pr`) |
| `finish_feature`: only when every Trace is built | `feature` → `built` (Decision by rule over the counts of `traces`) and `not_built` (a comment on the Feature, then `fail`) |
| the scenarios of the whole Feature | `feature` → `scenarios` (Value by rule over `traces.results`) |
| the `tune/` branch | `feature` → `tune_start` |
| `validate_prompt`, `validation.json` | `feature` → `validate` (profile `validator`, 75 min, an output schema instead of the file) |
| the check of the tuning, "validate fix" (resumed), removal when it still fails | `check_tune`, edge back to `validate` (`max: 1`), `drop_tune` |
| tuning pull request, `mark_verified` (label only), `comment` | `feature` → `deliver_tune` (from `validate.data`) |
| the pull requests of the Feature | `feature` → `prs` (Value by rule), then `ci` (Wait on `gh pr checks`) |
| `orchestrate_prompt`, task 1: STEER | `feature` → `steer` (profile `orchestrator`, an output schema with `sound_base`) |
| "the orchestrator must not change the code" | `feature` → `undo_steer` |
| `orchestrate_prompt`, task 2: DECIDE (`verdict.json`) | `feature` → `verdict` (Decision by rule: `halt` when `steer.data.sound_base = false` or the orchestrator gave no report) |
| halt stops the night | `night` → `features` with `haltOn: ["halt"]` |
| `gh stack link` in the morning | `night` → `stack` (Value by rule over `features.results`) and `link_stack` |
| `render`, `STATUS.md` | `night` → `summary` |
| usage-limit waits, `--network-grace` | `policy` in `night.json` (5, 60, 240 minutes) |

## Not ported, and why

- **Draft Traces** (`--draft-missing`). A flow cannot create issues from a plan file with the script's checks yet. The Trace source leaves out Traces with the label `draft` (`$skip` in its jq), and the Traces they block wait, as in the script.
- **Human gates** (`human-gate`, `--gate`). A Feature with that label is built like the others; its dependents do not wait for a person to close it. A Decision by a person before `traces` would be the port, once someone is awake to answer it.
- **Merge delivery** (`--delivery merge`). Only the stack. Merge it with `gh stack merge` in the morning.
- **One session per scenario.** The script gives each claimed scenario with no test its own worker session. Here one worker session builds all claimed scenarios of a try.
- **`--review-at skeleton|trace`, `--accept`, `--only`, `--max-traces`, `--retry-blocked`, `--require-label`.** One checkpoint per Feature only. A run after a `halt` runs the checkpoint of that Feature again.
- **The Trace Plan tick and `Closes #<feature>`.** The checkpoint sets the label `verified`, but does not tick the Trace in the Feature's Trace Plan. The last Trace's pull request does not close the Feature.
- **Resume of a Trace on a moved stack** (`base_left`, `night-failed/` branches). Branches and resume belong to the engine.
- **The smoke test of the agents at the start, `caffeinate`, the OpenCode setup.** Engine and harness work.
- **The Xcode Simulator.** Nothing to port: the check is the script's own `gate`, which does the format lint, the guards, the scenario tests, the tests of the affected Verticals, and the app builds and UI smoke set on the Simulator `rpg-pool-1`. `prepare` writes `.build/night/context.json`, so `gate` and `night-shift.py test` know the base and the claimed scenarios.

## Assumptions about the engine

- One worktree per run. `.build/night/` is ignored by git, so the files there (the base, the steering notes, the reports) survive the checkouts between items.
- In `feature.json`, after `traces`, the worktree is on the tip of the stack. `tune_start` branches off it. The engine does not know the `tune/` branch, so the next Feature's Traces do not build on the tuning, and the tuning pull requests are not part of the linked stack.
- The night's Call has `branch: shared`: the stack is the Traces. The first Trace of the next Feature must start on the last Trace that finished, also across Features.
- `session: resume` resumes the node's session of the same item, not of an earlier item.
- A Command node with `"output": "json"` reads all of stdout as JSON. `deliver` and `deliver_tune` send their log to stderr (`exec 3>&1 1>&2`) and print one JSON line at the end.
- `gh pr checks` exits 0 only when every check of the pull request passed. A repository without checks never reaches `done`: the Wait ends `timeout` after 30 minutes, and the night goes on.
