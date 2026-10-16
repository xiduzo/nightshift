# Night Shift

> A personal workbench to draw agent flows and run them unattended.

## What it does

- **Flows.** Draw a flow in a graph editor. A node is an agent session, a shell command, a decision, a gate that waits for you, a call to another flow, or a For Each over a list. Flows are JSON files in your repo (`.nightshift/flows/`).
- **Flows as functions.** A flow declares inputs and outputs. A flow can call another flow once, or once per element of a list. The list can come from a JSON value (for example a planner agent's output), a command, a glob of files, or GitHub sub-issues.
- **Agents that answer in shape.** An agent ends with a step report: an outcome (`pass`, `fail`, or its own) and, when you ask for it, data that matches a JSON schema.
- **Harnesses.** Each agent node runs on Claude Code, OpenCode, or Codex, with your own login for each. A node can add MCP servers.
- **Schedules.** `.nightshift/schedules.json` starts a flow at a set time, with a stop time.
- **Starters.** Flows to copy into a project are in [examples/starters/](examples/starters/).

Night Shift runs the flow on your machine while you sleep. You wake up to a stack of pull requests and a short list of gates.

Status: pre-alpha. Codex support is unverified, and OpenCode needs a 1.x build. The concept, decisions, and delivery order are in [docs/PLAN.md](docs/PLAN.md). The rules every contributor and agent follows are in [docs/steering/](docs/steering/).

## Run it

```bash
bun install
bun run db:push
bun run dev            # web UI and API with hot reload
bun run night          # a night: the built web UI and API, no hot reload
bun run dev:desktop    # the Electrobun shell
```

Run nights with `bun run night`, and develop in a separate git worktree, so a code change never reloads the daemon in the middle of a night. Setup details (schedules, harness paths, MCP secrets) are in [docs/PLAN.md §6](docs/PLAN.md#6-setup).

## Contribute

The proof of concept is built fast, without a spec method. The rules every change follows are in `docs/steering/TECH.md` and `docs/steering/QA.md`.

License: Apache-2.0.
