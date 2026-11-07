# Starter flows

Small, self-contained flows that ship with Night Shift. Change them to fit a project. The files are format version 6. Night Shift brings them to the current format, version 8, when you import them. Each one runs unattended: the agents use Claude Code in `auto` permission mode, and only a Gate waits for a person.

## The starter standard

A starter meets all four rules. A flow that needs a vendor account or an MCP server goes to [`community/`](../../../../community/) at the root of the repository.

1. **It fits any project.** No input has a default, because a default fits only some projects. Each input is required. The description of a command or a glob gives examples, such as `npm test` or `pytest`.
2. **It needs one agent login only.** It uses no `gh`, no other vendor CLI, no secret, and no MCP server.
3. **It is self-contained.** It uses no local scripts, no user paths, no Keychain, and no user skills.
4. **It starts on its own.** A helper flow that only a parent calls installs with its parent. `partOf` in `starters.ts` names that parent. No list that a person sees shows the helper as a starter.

`starters.test.ts` checks rules 1, 2 and 4.

<!-- checked:starters: every starter has one row. bun run docs:reference checks it. -->
| Flow | Inputs | Does |
| --- | --- | --- |
| `implement-and-check` | `task`, `check` (for example `npm test`) | One Agent with a cascade: Sonnet up to 3 tries, then Opus. After each try, its check runs `check` and fails on uncommitted changes. The next try gets the failure. The output `tier` says which tier finished. |
| `plan-and-build` | `goal`, `check` (for example `npm test`) | A planner returns tasks (`{ id, title, details, dependsOn }`) or asks you through a Gate when the goal is unclear. Each task runs the helper `build-task` on its own branch, stacked on the last one, in `dependsOn` order. `build-task` calls `implement-and-check` with `task` bound to `{{item.title}}: {{item.details}}`. A reviewer ends on `approved` or `changes-requested` with a list of `issues`. |
| `per-file` | `glob` (for example `docs/**/*.md`), `instruction` | Runs the helper `edit-file` once per file that matches the glob, all on one branch, then commits once. In `edit-file`, one agent applies the instruction to `{{item.path}}` and does not commit. |
| `review-learnings` | none | A Gate shows what agents proposed to learn about the project. What you keep goes into its [knowledge](../../../../docs/knowledge.md), and agents read it in later runs. |
<!-- /checked:starters -->

## Use them

1. Add the project in Night Shift. Leave "Add the starter flows" checked: Night Shift saves the starters and their helpers into the project. A flow that the project already has keeps its own version.
2. To add them later, import each file in this folder's `flows/`. Choose Import in the project's flow list, or run `nightshift flows import <file>` in the project's folder. A flow that calls another one needs it too: `plan-and-build` needs `build-task` and `implement-and-check`, and `per-file` needs `edit-file`.
3. Open a flow in the editor. Change the prompts and models to fit the project.
4. Start a run. The start dialog asks for the flow's inputs, for example the `check` command.

Commands get every template value as an environment variable, never as shell text. Thus `sh -c "{{check}}"` runs the input `check` as a command. The instruction in the commit message of `per-file` cannot inject shell code.
