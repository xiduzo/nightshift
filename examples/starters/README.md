# Starter flows

Small, self-contained flows (format version 6) to save into a project and change. Each one runs unattended: the agents use Claude Code in `auto` permission mode, and only a Gate waits for a person.

| Flow | Inputs | Does |
| --- | --- | --- |
| `implement-and-check` | `task`, `check` (default `bun test`) | An agent implements the task, a command runs `check`; a failed check goes back to a fresh agent with the log (3 tries in all), then a rescue on Opus. |
| `plan-and-build` | `goal`, `check` (default `bun test`) | A planner returns tasks (`{ id, title, details, dependsOn }`) or asks you through a Gate when the goal is unclear. Each task runs `build-task` on its own branch, stacked on the last one, in `dependsOn` order. A reviewer ends on `approved` or `changes-requested` with a list of `issues`. |
| `build-task` | `item` (a task), `check` | The body of `plan-and-build`: calls `implement-and-check` with `task` bound to `{{item.title}}: {{item.details}}`. |
| `review-pr` | `pr` (number or URL) | An agent with the CLI tool `gh` reviews the pull request: `approve` or `request-changes`, a summary, and comments per line. A Gate asks you before `gh pr review` posts it. |
| `per-file` | `glob` (default `src/**/*.ts`), `instruction` | Runs `edit-file` once per file that matches the glob, all on one branch, then commits once. |
| `edit-file` | `item` (a file), `instruction` | The body of `per-file`: one agent applies the instruction to `{{item.path}}` and does not commit. |

## Use them

1. Add the project in Night Shift.
2. Save the flows into the project. Night Shift keeps flows itself, so do not copy the files into the project. A flow that calls another one needs it too: `plan-and-build` needs `build-task` and `implement-and-check`, `per-file` needs `edit-file`. Choose Import in the project's flow list for each file in `examples/starters/flows/`, or run `nightshift flows import <file>` for each one in the project's folder.
3. Open a flow in the editor, and change the prompts, models, and `check` to fit the project.
4. Start a run: the start dialog asks for the flow's inputs.

Commands get every template value as an environment variable, never as shell text, so `sh -c "{{check}}"` runs the input `check` as a command, and the review text in `review-pr` cannot inject shell code.
