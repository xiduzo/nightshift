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

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
