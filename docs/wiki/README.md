# Night Shift

Night Shift runs your coding-agent pipeline as a flow that you draw. It runs on your own computers while you sleep. You wake up to pull requests and a short list of decisions that need you.

This wiki is the user guide. It tells you how to install Night Shift, draw flows, schedule nights, and answer what waits for you.

| Page | What is in it |
| --- | --- |
| [Get started](Get-started.md) | Install the desktop app, the Docker image, or a clone. Add a project and run a starter flow. |
| [Flows and nodes](Flows-and-nodes.md) | Outcomes, cascades, every node type, templates, Sections, kits, and starter flows. |
| [Agents and profiles](Agents-and-profiles.md) | The coding agents that Night Shift runs, profiles, backups, CLI tools, and connections. |
| [Runs and schedules](Runs-and-schedules.md) | Start a run, schedule a night, start a flow from a webhook, and resume a run. |
| [Gates and the inbox](Gates-and-the-inbox.md) | Gates, Asks, deadlines, files in an answer, and the Daily digest. |
| [Knowledge](Knowledge.md) | The files that agents read besides the code, and how to fill them. |
| [Computers and Hosts](Computers-and-Hosts.md) | Pair your computers with a Host. Spaces, Offers, and secrets. |
| [Phone app](Phone-app.md) | Watch the night and answer Gates from your phone. |
| [Terminal and MCP](Terminal-and-MCP.md) | The `nightshift` command, and the MCP tools for an agent in a terminal. |
| [Troubleshooting](Troubleshooting.md) | What a message means, and how to fix it. |

## Before you start

Night Shift is pre-alpha. It changes fast. Expect breaking changes to the flow format and the database.

Night Shift has run a real project every night since 2026-10-16.

## More docs

The repository holds the docs for people who build or run Night Shift:

- [Run a Host on a server](https://github.com/xiduzo/nightshift/blob/main/docs/deploy/README.md), and reach it over your LAN, Tailscale, a public server, or a tunnel.
- [Start a flow from another tool](https://github.com/xiduzo/nightshift/blob/main/docs/deploy/triggers.md) with a signed webhook.
- [The plan](https://github.com/xiduzo/nightshift/blob/main/docs/PLAN.md), [the glossary](https://github.com/xiduzo/nightshift/blob/main/docs/glossary.md), and [the architecture decisions](https://github.com/xiduzo/nightshift/tree/main/docs/adr).
- [Contributing](https://github.com/xiduzo/nightshift/blob/main/CONTRIBUTING.md) and [security](https://github.com/xiduzo/nightshift/blob/main/SECURITY.md).
