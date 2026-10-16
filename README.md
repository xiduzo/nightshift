# Night Shift

> A personal workbench to draw agent flows and run them unattended.

Draw a flow in a graph editor. Each step is an agent session with a prompt and/or a skill (Claude Code, OpenCode, Codex), a shell command, a decision, or a gate. Night Shift runs the flow on your machine, with your own CLI logins, while you sleep. You wake up to a stack of pull requests and a short list of gates.

Status: pre-alpha. The concept, decisions, and delivery order are in [docs/PLAN.md](docs/PLAN.md). The rules every contributor and agent follows are in [docs/steering/](docs/steering/).

## Run it

```bash
bun install
bun run db:push
bun run dev            # web UI and API with hot reload
bun run night          # a night: the built web UI and API, no hot reload
bun run dev:desktop    # the Electrobun shell
```

Run nights with `bun run night`, and develop in a separate git worktree, so a code change never reloads the daemon in the middle of a night. Starter flows to copy into a project are in [examples/starters/](examples/starters/).

## Contribute

The proof of concept is built fast, without a spec method. The rules every change follows are in `docs/steering/TECH.md` and `docs/steering/QA.md`.

License: Apache-2.0.
