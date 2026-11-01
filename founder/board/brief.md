# Board brief: Night Shift

You are reviewing a business idea. Everything you know about it is in this file. Do not assume facts that are not here; name missing numbers as open questions.

## The idea (from founder/idea.md)

- **What it is:** a local-first app where you draw your coding-agent pipeline as a flow (agent steps, checks, retries, decisions, gates), and it runs that flow overnight on your own computers with your own agent logins.
- **Who it is for:** small development teams (2–15 people) at agencies or startups that already use coding agents (Claude Code, Codex, OpenCode and others) and want shared overnight agent pipelines. Today the only real user is the author, a solo developer.
- **What it sells, at what price:** nothing yet. Apache-2.0 open source, pre-alpha. The founder wants to test it as an open-source project aiming at adoption, and asks whether it could become a business. Price: not set.
- **Where and how:** online, global. Source on GitHub; a macOS desktop app; a single-file server that can run as a "Host" on a server (Docker/systemd recipes); an iOS phone app that connects to the Host. Self-hosted only. No hosted service exists.
- **Budget and constraints:** no cash budget stated. One builder, alongside a day job. Local-first and "your own credentials" are core principles. No vendor-specific integrations (only cron, webhooks, shell/CLIs, files, git). macOS and Linux only.

## The problem it claims to solve (founder's words, condensed)

A developer with coding agents runs the same pipeline again and again: build, check, retry, rescue, open a pull request, review. Usually that pipeline is a script. Nobody can see it, and every change is a code change. Night Shift makes the pipeline a flow you draw. The engine owns the order, retries, loop limits and stop time. Agents do the work. People act only at "gates" (decision points that wait in an inbox). Tagline: "Draw your agent pipeline as a flow. Night Shift runs it on your machine while you sleep. You wake up to a stack of pull requests and a short list of decisions that need you."

## What exists today (built, on the main branch)

- **Flow editor** (visual canvas). Node types: Agent (one coding-agent session; can "cascade" from a cheap model to a stronger one with a check after each try), Command (shell command, e.g. tests), Tool (one MCP tool call), Decision (picked by a person = Gate, a rule, or a model with a confidence threshold), Value (structured data from a rule, model or person form), Wait, Subflow (run another flow once or per item), Join, End. Sections, auto-layout, undo/redo.
- **Agents supported:** Claude Code (verified), OpenCode, Codex, Grok Build, pi (local models via Ollama), any Agent Client Protocol agent. One flow can mix agents. Runs on the user's own CLI logins and subscriptions; Night Shift does not resell model access.
- **Runs that survive the night:** schedules with start/stop times, webhook triggers, retries with the failure log, rescue by a stronger model, usage-limit waits that resume, each run in its own copy of the repo, cost and token tracking per run.
- **AI assistant in the editor:** chat that proposes flow changes, "Suggest" on each field, "Ask why" a run failed. A CLI and an MCP server (`nightshift mcp`) let other agents read/save flows, start runs and answer gates.
- **Multi-computer:** computers pair with a Host; steps run on the computer they name. **Spaces** share projects, runs and gates with invited people (roles owner/admin/member/viewer). **Offers** let a person share their agent profiles with a Space with limits.
- **Phone app:** start a flow, follow a run live, answer a gate; push notifications when a gate waits or a run ends.
- **Knowledge:** a per-project folder of docs that agents can search (keyword, and semantic when Ollama runs).
- **Starter flows and "kits"** for git/GitHub/Jira steps (branch, draft PR, wait for CI, etc.).

## Traction and proof

- The author has run a real project through it every night since about 2026-10-16 (roughly two weeks at the time of this brief) and says it earns its keep.
- No other users are reported. No revenue. No waitlist or user research reported.
- A "pitch" (README, one-page site, signed desktop download) is planned but not done.

## What the founder has said about the business

- Asked how it makes money, the founder chose: **"Not a business yet — test it as an open-source project aiming at adoption; the board judges whether it could become a business."**
- First paying customer, if any: **small dev teams (2–15) at agencies or startups** who want shared overnight agent pipelines.
- Price: **no idea yet.**
- The founder prefers maintained libraries over custom infrastructure and avoids building vendor-specific integrations.

## Open numbers nobody has yet

Market size, number of teams already running agents overnight, willingness to pay, cost to acquire a user, competitor list and their prices. Do not invent these. Name them as open questions.
