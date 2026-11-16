# Night Shift

Night Shift runs your AI agents for you. You draw once how a job goes: which agent does each step, and where you want to decide. Night Shift then runs the job on your own computers, day and night, and asks you only what needs you.

Night Shift works like n8n or Zapier, but a step can be an agent that works for an hour.

This wiki is the user guide.

## Start here

New to Night Shift? Read these pages in this order:

1. [Get started](Get-started.md). Install the app, connect an agent, and run your first flow. About 15 minutes.
2. [How Night Shift works](How-Night-Shift-works.md). The main words: project, flow, node, run, Gate, schedule.
3. [Your first flow](Your-first-flow.md). Build a flow that writes a news brief each morning. About 15 minutes.

## Use Night Shift

| Page | Read it to |
| --- | --- |
| [Runs and schedules](Runs-and-schedules.md) | Start a run, schedule a flow, start a flow from a webhook, and resume a run. Read Home, Flow health, and Spend. |
| [Gates and the inbox](Gates-and-the-inbox.md) | Answer what waits for you, and choose when your phone tells you. |
| [Knowledge](Knowledge.md) | Give your agents notes, web pages, and documents to read. |
| [Community flows](Community-flows.md) | Import a flow that another person made, or share yours. |
| [Ideas](Ideas.md) | Find a flow that nobody has built yet. |
| [Phone app](Phone-app.md) | Answer Gates and follow your runs from your phone. |
| [Troubleshooting](Troubleshooting.md) | Find what a message means, and how to fix it. |

## Reference

| Page | What is in it |
| --- | --- |
| [Flows and nodes](Flows-and-nodes.md) | Every node type, templates, data shapes, the editor, kits, and the starter flows. |
| [Agents and profiles](Agents-and-profiles.md) | The agents that Night Shift runs, profiles, CLI tools, and connections. |
| [Computers and Hosts](Computers-and-Hosts.md) | Join your computers with a Host. Spaces, Offers, and secrets. |
| [Terminal and MCP](Terminal-and-MCP.md) | The `nightshift` command, and the MCP tools for an agent in a terminal. |

## Before you start

Night Shift is pre-alpha. It changes fast. Expect breaking changes to the flow format and the database.

Night Shift has run a real project every night since 2026-10-16.

## More docs

The repository holds the docs for people who build or run Night Shift:

- [Run a Host on a server](https://github.com/xiduzo/nightshift/blob/main/docs/deploy/README.md), and reach it over your LAN, Tailscale, a public server, or a tunnel.
- [Start a flow from another tool](https://github.com/xiduzo/nightshift/blob/main/docs/deploy/triggers.md) with a signed webhook.
- [The plan](https://github.com/xiduzo/nightshift/blob/main/docs/PLAN.md), [the glossary](https://github.com/xiduzo/nightshift/blob/main/docs/glossary.md), and [the architecture decisions](https://github.com/xiduzo/nightshift/tree/main/docs/adr).
- [Contributing](https://github.com/xiduzo/nightshift/blob/main/CONTRIBUTING.md) and [security](https://github.com/xiduzo/nightshift/blob/main/SECURITY.md).
