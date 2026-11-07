# Contributing to Night Shift

Thank you for your interest. Night Shift is pre-alpha and built for its author first. Read this before you start work.

## Before you start

- **Open an issue first** for anything bigger than a small fix. The plan changes fast, and a short talk saves you work that does not fit.
- **Read the plan.** [docs/PLAN.md](docs/PLAN.md) holds the settled decisions. To change one, propose it in an issue.
- **Use the product words** from [docs/glossary.md](docs/glossary.md): flow, run, step, node, gate, and so on. One name for one thing.

## Install and start

```bash
bun install
bun lefthook install   # git hooks: format, lint, the layer and vertical checks on commit
bun run dev            # web UI, API and phone app with hot reload, no .env needed
bun run dev:mobile     # the phone app alone, in Expo
bun run dev:desktop    # the desktop app
```

`bun run dev` keeps its data in `.nightshift-dev/`, apart from the Night Shift you use for real work. If you also run real nights from this checkout, change Night Shift in a separate git worktree. A code change then never reloads a run in the middle of the night.

A development install connects only to a Host on this computer. It does not pair or connect with a Host on another computer, so it stays out of your real work ([ADR 20](docs/adr/0020-one-computer-is-one-device.md)). To test against a remote Host, set `NIGHTSHIFT_DEV_LINK_HOST=true`.

## Check your change

```bash
bun test               # tests, next to the code as *.test.ts
bun run check-types    # TypeScript
bun run check          # Biome: lint and format
bun scripts/check-layers.ts      # packages depend only on lower layers
bun scripts/check-verticals.ts   # imports go through a vertical's barrel
bun run docs:reference --check   # the tables in the docs match the code
```

## The rules

Every change follows the steering documents:

- [TECH.md](docs/steering/TECH.md): the stack, the architecture, and the constraints. For example: store facts, never status, and every loop has a maximum count.
- [STRUCTURE.md](docs/steering/STRUCTURE.md): where code lives. Packages import only downward, and code inside a package is grouped by domain, not by kind.
- [QA.md](docs/steering/QA.md): the test strategy and the definition of done.
- [DESIGN.md](docs/steering/DESIGN.md) and [AGENTS.md](AGENTS.md): the UI is built from shadcn/ui components only, and UI copy tells the person what happens, not how Night Shift works inside.

Durable docs use plain, short sentences in the active voice (ASD-STE100 style).

The user guide is the [GitHub wiki](https://github.com/xiduzo/nightshift/wiki). Change it in [docs/wiki/](docs/wiki/), never on the wiki itself: a workflow publishes `docs/wiki/` when it lands on `main`. Some tables in the docs come from the code. After you change a node type, a kit, a starter, an agent, a CLI command, or an MCP tool, run `bun run docs:reference`.

## Pull requests

- Keep one change per pull request. When work builds in layers, open a stack of small pull requests with [`gh stack`](https://github.com/github/gh-stack).
- Complete the pull request template: why the change exists, what changed, and how you tested it.
- Use [Conventional Commits](https://www.conventionalcommits.org): `feat(web): …`, `fix(engine): …`, `docs: …`.

By contributing, you agree that your work is licensed under the [Apache-2.0 license](LICENSE).
