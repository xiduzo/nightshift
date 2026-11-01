# Night Shift

- What it is: a local-first app where you draw your coding-agent pipeline as a flow (agent steps, checks, retries, decisions, gates), and it runs that flow overnight on your own computers with your own agent logins.
- Who it is for: small development teams (2–15 people) at agencies or startups that already use coding agents (Claude Code, Codex, OpenCode and others) and want shared overnight agent pipelines. Today the only real user is the author, a solo developer.
- What it sells, at what price: nothing yet. It is an Apache-2.0 open-source project, pre-alpha. The founder chose to test it as an open-source project aiming at adoption, and asks the board whether it could become a business. Price: open question.
- Where and how: online, global. Distributed as source on GitHub, a desktop app (macOS), a single-file server (`nightshift`) that can run as a "Host" on a server, and a phone app (iOS) that connects to the Host. Delivery is self-hosted; no hosted service exists.
- Budget and constraints: no cash budget stated. Built by one person, alongside a day job. Local-first and "your own credentials" are core principles. Vendor-specific integrations are avoided (integrations go through cron, webhooks, shell/CLIs, files and git). macOS and Linux only.
