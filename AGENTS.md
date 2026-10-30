# Structure: a layered vertical codebase

Read `docs/steering/STRUCTURE.md` before you add a file, a folder or a package.

- **Layers point down.** A package imports only from lower layers (`db`, `flows`, `ui`,
  `ui-native` → `auth`, `agents` → `engine` → `devices`, `notifications` → `api`
  → `daemon`, `client` → apps). No package imports an app. The web and phone apps
  import only `client`, the `flows` root and `ui` or `ui-native`. A workspace
  declares only the workspaces it imports.
- **Group by domain, not by kind.** Put new code in the vertical it serves:
  `src/features/<vertical>/` in an app, `src/<vertical>/` in a package. Never
  create `lib/`, `utils/`, `hooks/` or `components/` at the top of `src/`, or a
  catch-all `types.ts`. No file or folder named `utils`, `helpers`, `common` or
  `misc` at any depth. Cross-cutting app code goes in a named `shared/<name>/`.
- **A vertical's barrel is its only door.** Import another vertical through its
  `index.ts`, never a file inside it. Every barrel export needs an outside importer.
  A barrel holds only imports and exports. No cycles between verticals, `import type`
  included.
- **Import only public entries.** Use a package's name and an entry listed in its
  `exports`. Never a deep path into its `src/`. Fakes and fixtures come from `./testing`.
  Every package entry, and every name on it, needs an importer in the production
  code of another workspace. Tests count only for `./testing`: a name that only
  tests use goes there. A type may also stay when a used name's declaration
  writes it (TS2883). No `export *`.
- **Apps wire, packages decide.** Domain logic goes in a package, not in `apps/*`.
  Routes in `apps/web` stay thin. Each web vertical owns its `queries.ts`.
- **Run the checks.** `bun scripts/check-layers.ts` and
  `bun scripts/check-verticals.ts` check these rules in every workspace. The
  pre-commit hook and CI run them too.
- **Do not copy a known deviation** (section 8 of `STRUCTURE.md`). Old code that breaks
  a rule is debt, not a pattern.

# UI: shadcn/ui only

The web app (`apps/web`) is built from [shadcn/ui components](https://ui.shadcn.com/docs/components)
and [blocks](https://ui.shadcn.com/blocks). Lean on them only and heavily.
`docs/shadcn.md` lists every component and block, what it is for, and where
Night Shift uses it. Read it before you build UI.

- **Reach for shadcn first.** Before writing any markup, find the component or
  block that does the job (`docs/shadcn.md`, then `bunx --bun shadcn@latest search`).
  Install missing ones with the CLI from `apps/web`; do not copy code by hand.
- **Compose, do not invent.** Pages are shadcn components put together: Sidebar
  for the shell, Card for groups and stats, Item or Table for lists, Badge for
  status, Empty for nothing-yet, Alert for in-page messages, Field for forms,
  Tabs or Toggle Group for views, Dialog, Sheet and Alert Dialog for overlays,
  Sonner for toasts.
- **No custom components or styles where shadcn has one.** No hand-rolled
  buttons, badges, cards, tabs, menus or form controls, and no parallel CSS
  classes. Style through theme tokens (`packages/ui/src/styles/globals.css`,
  `apps/web/src/index.css`) and Tailwind utilities on the call site.
- **Do not edit generated files** in `packages/ui/src/components`. If one must
  change, re-add it with `--overwrite` and reapply a small, commented diff.
- **Custom is for what shadcn does not cover**: the React Flow canvas (nodes,
  edges) and thin domain wrappers that compose shadcn pieces (a run-status
  Badge). Build those from shadcn components and tokens too.
- Style is `base-vega` on Base UI: use the `render` prop where Radix docs say
  `asChild`.

**The phone app** (`apps/mobile`) follows the same rules with
[React Native Reusables](https://github.com/founded-labs/react-native-reusables) (shadcn for React
Native) on Uniwind. The components live in `packages/ui-native`. Install
them with its CLI, do not copy code by hand. Compose, do not invent: no
hand-rolled buttons, cards or form controls. Do not use the HeroUI Native
components of the Better-T-Stack template. Do not edit the generated files
in `packages/ui-native`. `docs/research/mobile.md` holds the design.

# UI copy: guide the person, hide the internals

Every visible string tells the person what a control does for them and what
happens next. It does not explain how Night Shift works inside. This covers
titles, descriptions, hints, placeholders, empty states, tooltips, toasts,
aria-labels, push notifications, and the messages the server sends to the
UI (run end reasons, schedule reasons, flow issues). The same rules hold on
the phone. A push says what waits and nothing more: "A Gate waits for you".
Use the `ux-copy` and `ste-writing` skills.

- **No implementation details.** Do not show: the daemon, worktrees, file
  paths (`logs/<run>/...`), PATH, environment variables, `sh -c`, stdout,
  stdio, exit codes, adapters, leases, event names, "parse".
  Bad: "The daemon starts the flow at these times, each run in a new
  worktree. Saved in the flow document."
  Good: "Choose a flow and when it runs. Night Shift starts it for you at
  those times."
- **Say instead:** "Night Shift" or "this computer" for the daemon. Leave
  worktrees out, or say "its own copy of the project" only when the person
  must know it. "Schedules are paused" for the scheduler being off. "Not
  valid" for "does not parse". "Check the format of X" for "Fix the JSON of X".
- **Keep the product words** from `docs/glossary.md`: flow, run, step, node,
  gate, schedule, profile, connection, secret, input, output, outcome. One
  name for one thing.
- **Technical fields stay technical, with an example.** A cron field, a JSON
  value, a shell command, an MCP server, `{{template}}` and `${NAME}` syntax
  keep their words. Give one short example, not a definition.
- **Write plainly.** Address the person as "you". Lead with the action or
  the result. One idea per sentence, max 20 words, active voice, simple
  present. No semicolons, no contractions, no marketing adjectives.
  A description that only repeats its label goes.
- **Patterns.** Empty state: what this is, and how to start. Error: what
  happened, and how to fix it. Button: verb and object ("Add schedule").
- **Say less.** Cut before you rewrite. A description gets 1–2 sentences,
  a hint gets 1. Drop what the label, placeholder, unit or example already
  says, and drop decoration ("For the night."). Keep only the facts the
  person needs to decide or to fix something: limits, risks, what is lost.
  A field needs no description: make the prop optional, do not fill it.
- **Balance.** UX copy decides what to say (the action, the result, what
  happens next). STE decides how to say it (short words, active voice).
  The result is plain and friendly, not robot text.
  `docs/steering/DESIGN.md` ("Copy") has the checklist and examples.

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
