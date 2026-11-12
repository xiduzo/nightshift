# 22. A project folder is optional

Status: accepted, 2026-11-11. Built, 2026-11-12, in wave 1, lane A
([the record](../research/any-domain-2026-11.md), Q7, Q9, Q10, Q27).
[ADR 2](0002-flows-are-night-shift-data.md) stays: a flow belongs to one project.

## Context

A project is a git repository, known by its remote. Its folder on a Device is a
Clone. Every run assumes that folder:

- Every run gets its own worktree and branch in the Clone. Run start makes them
  before the first step, for every flow (`packages/engine/src/run/run-start.ts`).
  On an offline Device, the first step that needs the worktree makes it.
- Runs start only in a folder at the top of a git repository with a first commit.
  Add project checks this and offers "Set up git".
- The run plan refuses a run's Device without a Clone of the project.
- Every schedule runs on the Host
  ([ADR 15](0015-a-schedule-always-runs-on-the-host.md)). A Host copies only
  projects with a GitHub remote. So a flow on a schedule needs a GitHub remote.
- A flow cannot exist without a project. A flow belongs to one project (ADR 2),
  and every run row names its project.
- Each node type says what its step needs of a Device (`works()`). An Agent, a
  Command, a Service and a Wait by command work in the run's worktree. A Tool, and
  a Decision or Value by a model, need only the Device. A Gate, a rule and a timer
  need no computer. Run start does not read this: it makes a worktree every time.

Night Shift now serves any domain. A flow for research, monitoring or outreach
often has no repository. The person had to make one, and a GitHub remote too for a
schedule. On 2026-11-11 the owner chose "flows without a project", and then the
refined form C-prime.

## Decision

1. **A project is a container.** It holds flows, schedules, knowledge, secrets
   and runs. Its folder is optional. Add project gets a choice without a folder.
2. **A bound folder is always git.** When a person adds a folder that is not a git
   repository, Night Shift sets git up for it. The UI does not show git: "Night
   Shift keeps the history of this folder".
3. **A run with a folder works as today.** It gets its own copy of the project: a
   worktree and a branch from a base ref.
4. **A run without a folder gets its own empty folder.** Night Shift makes it in
   its data folder. The steps that work in a folder (an Agent, a Command, a
   Service, a Wait by command) work there.
5. **The files in that folder are the run's files.** The run page shows them.
   Night Shift removes the folder a set number of days after the run ends.
6. **Memory between runs is kept variables and knowledge.** The next run does not
   see the run folder of the last one. A flow keeps what it needs in a kept
   variable or in the project's knowledge.
7. **A project without a folder needs no copy.** Any Device of the Space can take
   its steps, the Host too. Its schedules run on the Host without a GitHub remote.

## Alternatives

- **Keep git as the substrate, with new words (Q7, option A).** No engine change.
  But every flow still needs a repository, and a flow on a schedule a GitHub
  remote. A person who watches a web page makes a repository for nothing.
- **Flows without a project (Q7, option C).** A flow stands alone. But a project
  also holds schedules, knowledge, secrets and runs, and ADR 2 gives each flow one
  project. C-prime keeps the container and makes only the folder optional.

## Consequences

- A run without a folder has no worktree, branch or base ref. The run columns
  `worktree_path`, `branch` and `base_ref` stay empty. They take an empty value
  already, for a run that waits for its offline Device.
- Run start makes a worktree only for a project with a folder.
- The Branches page, "Start from" and Changed files show only for a project with
  a folder.
- A Host no longer refuses a schedule of a project without a folder. For a project
  with a folder, ADR 15 decision 3 stays: a Host without its copy refuses the
  start.
- In [ADR 17](0017-a-run-takes-the-first-device-that-can.md) decision 3, every
  Device "has the project" when the project has no folder.
- The cleanup of run copies keeps a copy with uncommitted work, as today. A run
  folder has no git, so its removal takes its files too. Lane A sets the number of
  days.
- A run folder has no git, so no Hand-off carries it to another Device. Lane A
  decides what a step on a second Device of the same run sees.
- A project with a folder keeps everything it has today: its own copy per run, its
  branches and the Hand-off through the remote.
