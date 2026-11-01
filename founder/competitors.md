# Competitors: Night Shift

Date: 2026-11-01. Data: [competitors.csv](competitors.csv). Public sources only. Every fact has a link. The quotes are research, not testimonials.

**Limits of this research.** Reddit, G2, Capterra and Trustpilot blocked the reader, so the complaints come mostly from Hacker News, vendor forums, GitHub issues and one team-trial blog post. Developer tools have almost no review-site ratings. Codex's homepage returned 403, so it has no positioning line. Two facts come from third-party pages: the Jules price ([activepieces](https://www.activepieces.com/blog/google-jules-pricing-free-pro-and-ultra-plans-2026)) and Cursor's cron triggers ([DataCamp](https://www.datacamp.com/tutorial/cursor-automations-hands-on-guide)). Terragon was dropped because its site shows only "Terragon Shutdown" ([terragonlabs.com](https://www.terragonlabs.com/)).

## 1. Who is there, most direct first

| Name | Type | Where it runs | Several agent vendors | Schedules | Price for a small team | Their headline |
| --- | --- | --- | --- | --- | --- | --- |
| [OpenHands](https://www.openhands.dev/pricing) | Direct | Self-hosted: laptop, shared VM, own servers | Yes: own agent, Claude Code, Codex, Gemini CLI, OpenCode, any ACP agent | "Automations" on every plan, cron not described | Free (MIT). Teams $500/mo for up to 10 users, 5,000 sessions/mo | "OpenHands is an open source platform for software engineering agents." |
| [Claude Code](https://www.claude.com/product/claude-code) (web, [Routines](https://claude.com/blog/introducing-routines-in-claude-code), Actions) | Direct | Anthropic cloud, own machine (Desktop tasks), CI | No | Yes, Team cap 25 routine runs a day | Team $20/seat/mo annual, $25 monthly, min 2 seats ([pricing](https://claude.com/pricing)) | "Hand Claude a bug fix, test, or multi-day migration. Steer and review from your terminal, IDE, Slack, or web." |
| [GitHub Copilot cloud agent](https://github.com/features/copilot/agents) | Direct | GitHub cloud | Yes, Claude Code and Codex as third-party agents on paid plans | Yes, hourly, daily, weekly or on events ([2026-06-02](https://github.blog/changelog/2026-06-02-schedule-and-automate-tasks-with-copilot-cloud-agent/)) | Business $19/seat/mo with 1,900 AI credits per user ([plans](https://docs.github.com/en/copilot/get-started/plans)) | "Move from a single task to a project spanning repositories without losing context." |
| [Cursor](https://cursor.com/pricing) cloud agents and Automations | Direct | Cursor cloud sandboxes | Models yes, agents no | Yes, cron and events (third-party source) | Teams $30+/user/mo, runs use credits | "Cursor is your coding agent for building ambitious software." |
| [OpenAI Codex](https://learn.chatgpt.com/docs/pricing) | Direct | OpenAI cloud, local app and CLI | No | Yes, scheduled tasks listed on the pricing docs | ChatGPT Business $20/user/mo annual, $25 monthly, 5-hour and weekly limits | (homepage returned 403) |
| [Amp](https://ampcode.com/) | Direct | Amp-hosted "orbs" or self-hosted orbs | Uses ChatGPT or Claude subscriptions or own keys | Yes, events and a schedule the agent sets | $20/mo with 45,000 min of hosted orb time, self-hosted orbs unlimited ([pricing](https://ampcode.com/pricing)) | "Run agents anywhere and they keep working after you close your laptop." |
| [Devin](https://devin.ai/) | Direct | Vendor cloud, homepage also says "on your machine" | No | Yes, "scheduled workflows" | Teams $80/mo + $40/seat, task allowance not stated ([pricing](https://devin.ai/pricing)) | "Meet Devin, your team's autonomous software engineer" |
| [Factory](https://factory.com/) | Direct | Cloud and local background agents | Model providers yes | Yes, "scheduled workflows" | Teams $60/mo + $40/seat, up to 10 seats ([pricing](https://factory.com/pricing)) | "Build Your Software Factory" |
| [Google Jules](https://jules.google/) | Direct | Google cloud VM | No | Not mentioned | Pro $19.99/mo for 100 tasks a day (third-party source) | "Jules does coding tasks you don't want to do." |
| [Conductor](https://www.conductor.build/) | Indirect | Mac, local workspaces | Yes: Claude Code, Codex, Cursor | Not found | Teams $60/user/mo, free tier on your own subscriptions | "Run parallel coding agents on your Mac." |
| [Vibe Kanban](https://www.vibekanban.com/) | Indirect | Local, open source | Yes | Not mentioned | Free. Company shut down 2026-04-10 ([post](https://vibekanban.com/blog/shutdown)) | "Accelerate the human planning and review your coding agents are waiting on" |
| [Sculptor](https://imbue.com/sculptor/) | Indirect | Desktop app, agents in containers | Claude Code, Codex | Not mentioned | Not stated | "Sculptor: the missing UI for parallel coding agents" |
| [Claude Squad](https://github.com/smtg-ai/claude-squad) | Indirect | Terminal, open source (AGPL-3.0) | Yes | No | Free | "Manage multiple AI terminal agents like Claude Code, Codex, OpenCode, and Amp." |
| [n8n](https://n8n.io/pricing/) | Indirect | n8n cloud or self-hosted | Any model | Yes (general workflows) | Starter EUR 20/mo for 2.5K executions | "Build the agent. Understand its workflow." |
| Cron + `claude -p` or `codex exec` ([docs](https://code.claude.com/docs/en/headless)) | Substitute | Own machine or server | Whatever the script calls | Yes, cron | Free, on top of the agent subscription | — |
| GitHub Actions + [claude-code-action](https://github.com/anthropics/claude-code-action) | Substitute | GitHub runners | No | Yes, `schedule` trigger | Free action, plus Actions minutes and API usage | — |
| Run agents by hand in the day | Substitute | Own machine, attended | Any | No | The existing seat only | — |

## 2. Price range

The comparable item is "background agents for a team of 5, billed monthly". The figures below are list prices only. Most plans add usage or credits on top.

| | Product | 5 people, per month |
| --- | --- | --- |
| Lowest paid | GitHub Copilot Business | $95 + usage |
| | Jules Pro (per person, third-party price) | about $100 |
| | Codex (ChatGPT Business), Claude Team | $125 |
| Median | Codex, Claude Team | $125 |
| | Cursor Teams | $150+ |
| | Factory Teams | $260 |
| | Devin Teams | $280 + usage |
| | Conductor Teams (indirect) | $300 |
| Highest | OpenHands Teams | $500 (covers up to 10 users) |

Free options exist at every level: OpenHands open source, Claude Squad, Vibe Kanban, Amp self-hosted orbs and a cron script.

**The closest price signal for Night Shift is the layer on top of your own agent subscription**, because Night Shift also runs on the team's own logins. Three products charge for that layer: Conductor at $60 per user, OpenHands Teams at $500 for 10 users, and Amp, which charges for hosted machine time and gives self-hosted orbs free. `/founder-pricing` should start from these three, not from Devin or Cursor.

## 3. Positioning map

The two axes that matter to this buyer:
- **Where the work runs**: the vendor's cloud, or your own machines with your real stack.
- **What a run is**: one agent and one prompt that returns one PR, or a pipeline of several steps with checks, several agents and human approvals.

```
                         PIPELINE (steps, checks, gates, several agents)
                                          |
                    n8n (general, not     |   OpenHands (automations, many agents)
                    coding-specific)      |   [Night Shift aims here]
                                          |
    VENDOR CLOUD -------------------------+------------------------- YOUR MACHINES
                                          |
    Copilot agent, Cursor, Codex cloud,   |   Conductor, Sculptor, Claude Squad,
    Jules, Devin, Factory, Claude Routines|   Vibe Kanban (attended, parallel)
    (scheduled, one prompt → one PR)      |   Amp self-hosted orbs
                                          |   cron + claude -p (scheduled, one prompt)
                         ONE PROMPT, ONE PR
```

The bottom left is crowded. Every large vendor has added scheduling in 2026. The bottom right is full of free tools for running agents side by side while you watch. The top right has one strong resident, OpenHands, and Night Shift.

## 4. What their customers complain about

Ranked by the number of distinct sources. A theme with fewer than three sources is marked thin.

1. **Failed or looping runs still use up money or quota (about 21 sources: Codex, Cursor, Claude, Copilot, Devin, Jules).** This hurts most when nobody watches the run.
   - "if you put in a request and leave, it’s possible that when you come back your account is completely drained because the model went off on a tangent." ([Cursor forum](https://forum.cursor.com/t/pro-plan-burned-in-10-minutes-by-background-agent-calls-completely-unacceptable/118368))
   - "running just two small Codex Cloud tasks instantly consumed my entire 5-hour limit and 30% of my weekly quota." ([OpenAI community](https://community.openai.com/t/codex-cloud-used-my-entire-5-hour-limit-in-two-c-tasks-bug-or-policy-change/1364874))
2. **Unreliable runs: stuck, loops, timeouts, outages (about 17).**
   - "About 20% of the time Claude will never respond - so the github action times out after 6 hours." ([claude-code-action#674](https://github.com/anthropics/claude-code-action/issues/674))
   - "there doesn't seem to be an "ask for help" escape hatch in it" (Devin, [HN](https://news.ycombinator.com/item?id=42734681))
3. **The vendor's cloud sandbox cannot run the real stack (about 12: Claude, Copilot, Codex).** No containers, no databases, a firewall that blocks dependencies, setup logs that are cut off.
   - "I would need to spawn a half dozen services locally in order to have a proper simulation of my actual working environment." ([HN](https://news.ycombinator.com/item?id=45647166))
   - "The agent was blocked by configuration issues from accessing the necessary dependencies to successfully build and test." ([dotnet/runtime#115733](https://github.com/dotnet/runtime/pull/115733))
4. **Lock-in: GitHub only, the vendor's cloud only, no self-hosting (about 10).**
   - "It's inferior to a Cron job. If my repos happen to be self hosted with Forgejo or codeberg, then it won't even work. … Schedules lock-in, all over the web." ([HN](https://news.ycombinator.com/item?id=47539188))
   - "We need to fight model providers trying to own memory, workflows and tooling." (same thread)
5. **PRs need heavy rework (about 10).** One team trial of about 130 Copilot agent PRs reports a 23% merge rate against 98% for human PRs ([create.pt](https://blogit.create.pt/?p=13621)).
6. **Little control over model, effort and spend (about 5, thin per product).**
   - "If agents are allowed to run wild and spend your plan balance autonomously, this must be opt-in, transparent, and capped." ([Cursor forum](https://forum.cursor.com/t/pro-plan-burned-in-10-minutes-by-background-agent-calls-completely-unacceptable/118368))

Ratings: Cursor 1.5 from 354 reviews on [Trustpilot](https://www.trustpilot.com/review/cursor.com), for the whole product, mostly about cost and billing. Devin 2.9 from 2 reviews on [Trustpilot](https://www.trustpilot.com/review/devin.ai), too few to mean anything. No rating exists for the others.

What users say they wish existed (each named by 1–3 sources, so all thin):
- Running on their own machine or server, with their real services.
- Spend caps, and a confirmation before an agent spends.
- A way to ask for help, or a stop button, instead of churning.
- Scheduling with no low cap, on any git host.
- Chains of steps. "The win wasn’t one smart chat. It was the chain." ([Cursor forum](https://forum.cursor.com/t/1-500-in-one-week-running-a-grok-bot-fleet-expected-or-a-bug/172705)). The same small team found the chain too expensive to keep.
- A middle ground between a one-shot PR and an interactive session.

One user describes the Night Shift morning exactly, with a condition: "it’s cool to delegate some PRs at the end of the day, and then come back tomorrow to review that code. But it’s not very practical unless the quality of that PR is high or the task is very small in scope." ([create.pt](https://blogit.create.pt/?p=13621))

## 5. The gap

There is a gap, and it is narrow. Nobody in the evidence does all four of these things well together:

1. **Runs on your own machines, with your real stack.** Complaint 3 (about 12 sources) exists because the vendors run in their own sandboxes. Night Shift runs where the project already builds and tests.
2. **Uses the subscriptions the team already pays for.** It adds no second credit pool to drain. Complaint 1 (about 21) is about surprise spend. Night Shift does not fix runaway usage of the agent subscription itself. A per-run limit and a stop on loops would turn this into a real answer, and the evidence asks for exactly that.
3. **A pipeline with checks and human gates, not one prompt.** Complaints 2 and 5 say that a single unattended prompt often fails or needs rework. Checks before the PR and a gate that asks a person match the "ask for help" and "only if the PR quality is high" asks.
4. **Not tied to one vendor or one git host.** Complaint 4 (about 10) asks for exactly this, and vendors cannot offer it without helping their rivals.

The gap is **"the morning is trustworthy"**, not "agents run at night". Scheduling alone is no longer a gap. Claude Code, Copilot, Cursor, Codex, Devin and Factory all added it in 2026.

The evidence for points 3 and 4 is thinner than for points 1 and 2. Nobody measured whether checks and gates raise the merge rate. That is the number the board asked for (the 10x number), and outside teams must produce it.

**The gap is not empty.** OpenHands sits in the same corner: open source (MIT), 92.4k stars on [GitHub](https://github.com/OpenHands/OpenHands), self-hosted, runs Claude Code, Codex and OpenCode, and lists automations. The sources do not show drawn multi-step flows, human gates or a phone app in OpenHands. Night Shift must differ from it on those points, or the gap belongs to OpenHands.

## 6. The threat: who could copy Night Shift fastest

1. **OpenHands.** It has the same shape, a company behind it, an open-source user base and a paid self-hosted Teams plan. Adding a flow editor and gates to its automations is a smaller step for it than building its user base is for Night Shift. This is the most likely copy.
2. **The agent vendors.** Anthropic already offers Routines, Desktop tasks that run on your own machine, and self-hosted sessions in public beta ([docs](https://code.claude.com/docs/en/scheduled-tasks)). GitHub already runs Claude Code and Codex inside Copilot automations. Either one is close to "scheduled pipelines on your machine". They will stay single-vendor or tied to their own platform, which leaves point 4 open.
3. **Amp.** Its self-hosted orbs already keep running after the laptop closes and use your own ChatGPT or Claude subscription.
4. **Forks.** Night Shift is Apache-2.0. Anyone can take the code. A fork does not get the shared flow library or the users, which is why the board named the library as the moat to start.

## Inputs for the next skills

- `/founder-consumer`: use complaints 1–5 as objections. Test the strongest one directly: "I tried background agents, and the PRs were not worth reviewing."
- `/founder-pricing`: the range is $95–$500 a month for 5 people, and free at every level. The comparable layer on top of your own subscription costs $60 per user (Conductor) to $500 per 10 users (OpenHands Teams).
- `/founder-board` conditions: "Name the small market" now has a candidate: small teams that need the real stack to test and do not want to be tied to one vendor or one git host. Its size is still unknown.
