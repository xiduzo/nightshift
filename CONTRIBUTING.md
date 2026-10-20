# Contributing to Night Shift

Thank you for your interest. Night Shift is pre-alpha and built for its author first, so read this before you start work.

## Before you start

- **Open an issue first** for anything bigger than a small fix. The plan changes fast, and a short talk saves you work that does not fit.
- **Read the plan.** [docs/PLAN.md](docs/PLAN.md) holds the settled decisions. To change one, propose it in an issue.
- **Use the product words** from [docs/glossary.md](docs/glossary.md): flow, run, step, node, gate, and so on. One name for one thing.

## Set up

```bash
bun install
bun lefthook install   # git hooks: format, lint, the layer and vertical checks on commit
bun run db:push        # the dev database in .nightshift-dev/
bun run dev            # web UI and API with hot reload
```

## Check your change

```bash
bun test               # tests, next to the code as *.test.ts
bun run check-types    # TypeScript
bun run check          # Biome: lint and format
bun scripts/check-layers.ts      # packages depend only on lower layers
bun scripts/check-verticals.ts   # imports go through a vertical's barrel
```

## The rules

Every change follows the steering documents:

- [TECH.md](docs/steering/TECH.md): the stack, the architecture, and the constraints. For example: store facts, never status, and every loop has a maximum count.
- [STRUCTURE.md](docs/steering/STRUCTURE.md): where code lives. Packages import only downward, and code inside a package is grouped by domain, not by kind.
- [QA.md](docs/steering/QA.md): the test strategy and the definition of done.
- [DESIGN.md](docs/steering/DESIGN.md) and [AGENTS.md](AGENTS.md): the UI is built from shadcn/ui components only, and UI copy tells the person what happens, not how Night Shift works inside.

Durable docs use plain, short sentences in the active voice (ASD-STE100 style).

## Pull requests

- Keep one change per pull request. When work builds in layers, open a stack of small pull requests.
- Fill in the pull request template: why the change exists, what changed, and how you tested it.
- Use [Conventional Commits](https://www.conventionalcommits.org): `feat(web): …`, `fix(engine): …`, `docs: …`.

By contributing, you agree that your work is licensed under the [Apache-2.0 license](LICENSE).
