# Starter flows

Small, self-contained flows that ship with Night Shift. Change them to fit a project. The files are format version 6. Night Shift brings them to the current format, version 8, when you import them. Each one runs unattended: the agents use Claude Code in `auto` permission mode, and only a Gate waits for a person.

<!-- checked:starters: every starter has one row. bun run docs:reference checks it. -->
| Flow | Inputs | Does |
| --- | --- | --- |
| `implement-and-check` | `task`, `check` (default `bun test`) | One Agent with a cascade: Sonnet up to 3 tries, then Opus. After each try, its check runs `check` and fails on uncommitted changes. The next try gets the failure. The output `tier` says which tier finished. |
| `plan-and-build` | `goal`, `check` (default `bun test`) | A planner returns tasks (`{ id, title, details, dependsOn }`) or asks you through a Gate when the goal is unclear. Each task runs `build-task` on its own branch, stacked on the last one, in `dependsOn` order. A reviewer ends on `approved` or `changes-requested` with a list of `issues`. |
| `build-task` | `item` (a task), `check` | The body of `plan-and-build`: calls `implement-and-check` with `task` bound to `{{item.title}}: {{item.details}}`. |
| `review-pr` | `pr` (number or URL) | An agent with the CLI tool `gh` reviews the pull request: `approve` or `request-changes`, a summary, and comments per line. A Gate asks you before `gh pr review` posts it. |
| `per-file` | `glob` (default `src/**/*.ts`), `instruction` | Runs `edit-file` once per file that matches the glob, all on one branch, then commits once. |
| `edit-file` | `item` (a file), `instruction` | The body of `per-file`: one agent applies the instruction to `{{item.path}}` and does not commit. |
| `review-learnings` | none | A Gate shows what agents proposed to learn about the project. What you keep goes into its [knowledge](../../../../docs/knowledge.md), and agents read it in later runs. |
| `watch-logs` | `logs`, `pattern` (default `error\|exception\|fatal\|panic`), `check` | A Command with no model runs `logs` and keeps the lines that match `pattern`. It drops each line whose fingerprint (the line without numbers, ids and times) is in `watch-logs/seen.txt` of the knowledge. Thus no agent runs when nothing is new. An Agent with a cascade, Sonnet then Opus, ends on `found`, `noise`, or `fail` when no tier finds the cause. On `found`, a Gate asks you to `fix` (a call of `implement-and-check` with `check`) or `ignore`. `noise`, `ignore` and a fix that passes add the fingerprints to the seen file. |
| `scout-and-pick` | `topic`, `count` (default `3`) | A Sonnet agent searches the knowledge and the web. It reports up to `count` candidates (`{ name, label, description }`), or `none`. An Ask shows them, and you pick one or leave it empty. A rule Branch ends the run when you pick none. An Agent with a cascade, Sonnet then Opus, writes a report as data, and a Command saves it as `scout/<name>.md` in the knowledge. |
| `draft-slides` | `source`, `file` (default `slides.md`) | An Agent with a cascade, Sonnet then Opus, reports a Marp deck in its data. A Gate shows the deck: `keep`, or `revise` with a note that the next draft reads. The `revise` edge has a max of 3, and a fourth `revise` ends the run as failed. On `keep`, a Command writes `file` and commits it. |
<!-- /checked:starters -->

## Use them

1. Add the project in Night Shift. Leave "Add the starter flows" checked: Night Shift saves all of them into the project. A flow that the project already has keeps its own version.
2. To add them later, import each file in this folder's `flows/`. Choose Import in the project's flow list, or run `nightshift flows import <file>` in the project's folder. A flow that calls another one needs it too: `plan-and-build` needs `build-task` and `implement-and-check`, `watch-logs` needs `implement-and-check`, and `per-file` needs `edit-file`.
3. Open a flow in the editor. Change the prompts, models, and `check` to fit the project.
4. Start a run. The start dialog asks for the flow's inputs.

Commands get every template value as an environment variable, never as shell text. Thus `sh -c "{{check}}"` runs the input `check` as a command. The review text in `review-pr` cannot inject shell code.
