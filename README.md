# Night Shift

> An open agent orchestrator for spec-driven development.

Night Shift runs a spec-driven method (WTF, OpenSpec, your own) as a deterministic pipeline of agent sessions, on your machine, with people in the loop only at gates. Specs stay where your team keeps them: GitHub Issues, Jira, or files in the repo. Pull requests land as stacks. The daemon does the work. The desktop app makes it usable for everyone on the team.

Status: pre-alpha. The concept, decisions, and delivery order are in [docs/PLAN.md](docs/PLAN.md). The rules every contributor and agent follows are in [docs/steering/](docs/steering/).

## Run it

```bash
bun install
bun run db:push
bun run dev            # web UI and API with hot reload
bun run dev:desktop    # the Electrobun shell
```

## Contribute

This repo is built with [WTF](https://github.com/xiduzo/wtf). Plan with `/wtf.write-epic`, build with `/wtf.loop`. Every pull request answers to `docs/steering/TECH.md` and `docs/steering/QA.md`.

License: Apache-2.0.
