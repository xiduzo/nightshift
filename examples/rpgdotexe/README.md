# rpgdotexe: the night as flows

These three flows rebuild `tools/night-shift/night-shift.py` of the rpgdotexe repo as Night Shift flows. They build the Features and the Traces of one Epic while nobody is present, and leave a stack of pull requests for the morning.

| Flow | Input | Does |
| --- | --- | --- |
| `night.json` | none (the run starts here) | For Each Feature of the Epic (label `feature`), blockers first: runs `feature`. Halts the night when a Feature ends on `halt`. Then writes `.build/night/STATUS.md`. |
| `feature.json` | a Feature | For Each Trace of the Feature (label `trace`, not `implemented`), blockers first, each on its own branch on top of the last: runs `trace`. Then the checkpoint: the validator verifies and tunes on a `tune/` branch, the orchestrator writes steering notes, and a decision picks `continue` or `halt`. |
| `trace.json` | a Trace | The worker builds the Trace, the check runs, a failed check goes back to a fresh worker (3 tries), then a rescue on Opus. A Trace that passes gets a pull request on the stack and the label `implemented`. A Trace that still fails ends as failed, so the Traces that wait on it are blocked. |

## How to use it

1. Copy `.nightshift/flows/` into your rpgdotexe clone.
2. In `night.json`, set the Epic number: `nodes[0].source.parent` (`"699"` is a placeholder; flows have no run parameters).
3. Add the clone as a project in Night Shift.
4. Run the flow `night` with a stop time. A stop starts no new work; the next run continues, because a Trace with the label `implemented` counts as done.
5. In the morning, read the pull requests, `.build/night/STATUS.md` in the run's worktree, and the comment of the checkpoint on each Feature.

The flows call `python3 tools/night-shift/night-shift.py gate` (the check) and import two helpers from that file. Keep the script in the repo until the check moves somewhere else.

## Script step → node

| Script (`night-shift.py`) | Flow node |
| --- | --- |
| `fetch_plan`, `blockers_first`, Features first | `night` → `features` (For Each, GitHub source, `requireLabel: feature`) |
| Traces of a Feature, `next_action`, a blocked Trace skips its dependents | `feature` → `traces` (For Each, `requireLabel: trace`, `doneLabels: [implemented]`, `branchPerItem`) |
| `build_trace`: branch, `write_context` (`context.json`, `TRACE.md`, `FEATURE.md`) | `trace` → `prepare` (the engine makes the branch) |
| `worker_prompt` + `RULES` + `trace_task` / `fix_task`, a new session each try | `trace` → `worker` (Sonnet, effort high, `session: fresh`, 90 min, idle 30) |
| `format_swift` | `trace` → `format` |
| `loop_gate` (loose changes, no commit, protected files) + `gate` | `trace` → `check` |
| `--attempts 3` | edge `check` → `worker` on `fail`, `max: 2` (3 tries in all) |
| `rescue_prompt` on the orchestrator | `trace` → `rescue` (Opus, 75 min) |
| rescue 2: `fix_prompt`, resuming the rescue session | edge `check2` → `rescue` on `fail`, `max: 1`, `session: resume` |
| `block_trace` (commit the loose work) | `trace` → `park`, which ends as `fail` |
| `deliver` + `pr_body` + `label(..., "implemented")` | `trace` → `deliver` |
| `finish_feature`: only when every Trace is built | `feature` → `built` |
| the `tune/` branch | `feature` → `tune_start` |
| `validate_prompt` | `feature` → `validate` (Sonnet, 75 min) |
| the check of the tuning, "validate fix" (resumed), removal when it still fails | `check_tune`, edge back to `validate` (`max: 1`), `drop_tune` |
| tuning pull request, `mark_verified` (label only), `comment` | `feature` → `deliver_tune` |
| `orchestrate_prompt`, task 1: STEER | `feature` → `steer` (Opus) |
| "the orchestrator must not change the code" | `feature` → `undo_steer` |
| `orchestrate_prompt`, task 2: DECIDE (`verdict.json`) | `feature` → `orchestrate` (Decision: `continue`, `halt`) |
| halt stops the night | `night` → `features` with `haltOn: ["halt"]` |
| `render`, `STATUS.md` | `night` → `summary` |
| usage-limit waits, `--network-grace` | `policy` in `night.json` (5, 60, 240 minutes) |

The script's roles map to Claude Code models: the worker on Sonnet (the script's default worker is a local OpenCode model, and Night Shift has only the Claude Code harness for now), the validator on Sonnet, and the orchestrator (rescue, steering, decision) on Opus. This is the setup that the script's README gives as its example.

The agents get the script's prompts, not the `wtf.*` skills: those skills ask the person questions, and nobody is awake.

## Not ported, and why

- **Draft Traces** (`--draft-missing`). A flow cannot create issues from a plan file with the script's checks yet. The Trace source skips Traces with the label `draft` (`skipLabels`), and the Traces they block wait, as in the script.
- **Human gates** (`human-gate`, `--gate`). A Feature with that label is built like the others; its dependents do not wait for a person to close it.
- **Merge delivery** (`--delivery merge`). Only the stack. Merge it with `gh stack merge` in the morning.
- **`gh stack link`.** Each pull request goes on the branch below it (`--base`), but the flow does not link the stack on GitHub: that needs the list of all layers of the night. Link it in the morning, or wait for the engine's "link stack" tool.
- **One session per scenario.** The script gives each claimed scenario with no test its own worker session. Here one worker session builds all claimed scenarios of a try.
- **`--review-at skeleton|trace`, `--accept`, `--only`, `--max-traces`, `--retry-blocked`, `--require-label`.** One checkpoint per Feature only. A run after a `halt` runs the checkpoint of that Feature again.
- **The Trace Plan tick and `Closes #<feature>`.** The checkpoint sets the label `verified`, but does not tick the Trace in the Feature's Trace Plan. The last Trace's pull request does not close the Feature.
- **Resume of a Trace on a moved stack** (`base_left`, `night-failed/` branches). Branches and resume belong to the engine.
- **The smoke test of the agents at the start, `caffeinate`, the OpenCode setup.** Engine and harness work.
- **The Xcode Simulator.** Nothing to port: the check is the script's own `gate`, which does the format lint, the guards, the scenario tests, the tests of the affected Verticals, and the app builds and UI smoke set on the Simulator `rpg-pool-1`. `prepare` writes `.build/night/context.json`, so `gate` and `night-shift.py test` know the base and the claimed scenarios.

## Assumptions about the engine

- One worktree per run. `.build/night/` is ignored by git, so the files there (the base, the steering notes, the reports) survive the checkouts between items.
- In `feature.json`, after `traces`, the worktree is on the tip of the stack. `tune_start` branches off it. The engine does not know the `tune/` branch, so the next Feature's Traces do not build on the tuning.
- The night's For Each has `branchPerItem: false`: the stack is the Traces. The first Trace of the next Feature must start on the last Trace that finished, also across Features.
- `session: resume` resumes the node's session of the same item, not of an earlier item.
