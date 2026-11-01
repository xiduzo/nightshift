# Buyer panel: Night Shift: open-source app that runs a team's coding-agent pipelines overnight on their own computers and logins

**0 buy · 30 pass** (0% buy) out of 30 simulated buyers. Seed 960871, so the same cards can be dealt again.

70 of 100 buyers have no valid answer and are left out: P031 (missing), P032 (missing), P033 (missing), P034 (missing), P035 (missing), P036 (missing), P037 (missing), P038 (missing), P039 (missing), P040 (missing).

These are simulated buyers, not customers. Use this to find objections and weak spots, then confirm the big ones with real people before you spend.

## By segment

| group | buyers | buy rate |
| --- | ---: | ---: |
| Tech lead at a small digital agency | 10 | 0% |
| Senior developer who picks the tools for a small team | 6 | 0%  (thin) |
| Owner or managing director of a small agency who holds the budget | 9 | 0% |
| Founder or CTO of an early-stage startup | 5 | 0%  (thin) |

## By buying behaviour

| group | buyers | buy rate |
| --- | ---: | ---: |
| Vendor default is good enough | 5 | 0%  (thin) |
| Burned by background agents | 4 | 0%  (thin) |
| Scripts it themselves | 3 | 0%  (thin) |
| Watches every subscription | 4 | 0%  (thin) |
| Tool tinkerer | 5 | 0%  (thin) |
| Waits for proof from others | 4 | 0%  (thin) |
| Open source and self-host first | 5 | 0%  (thin) |

## By income

| group | buyers | buy rate |
| --- | ---: | ---: |
| under $102,000 | 10 | 0% |
| $102,000 to $113,000 | 8 | 0% |
| $113,000 and up | 12 | 0% |

## Why they pass

| reason | buyers | in their words |
| --- | ---: | --- |
| trust | 18 | "I already threw away most of the PRs that background agents opened for us, and running them overnight just means I triage the junk in the morning. A pre-alpha tool from one developer won't change that, and I don't have time to draw flows and pair machines." (P002) · "I have a spare Mac mini, so I'd try the free self-hosted version before paying $99 a month. And a pre-alpha built by one developer running agents unattended on our paid quotas overnight is exactly the setup I fear will loop and burn tokens." (P004) |
| habit | 9 | "We already get scheduled agents and PRs out of Claude Code and GitHub with the seats the company pays for. Drawing pipelines in a separate tool is one more thing I have to maintain." (P001) · "I already have a cron job calling claude -p that opens PRs, and it works well enough. A pre-alpha tool from one developer is not something I move my team's pipeline onto, and the free self-hosted version covers me anyway if I get curious." (P003) |
| quality | 1 | "I'd maybe self-host the open source version to poke at it, but I won't pay $99 for Cloud. My problem with background agents was never scheduling. It was that the PRs were junk, and a nicer pipeline doesn't prove it fixes that." (P017) |
| need | 1 | "I already run claude -p from cron for the boring stuff, and the free self-hosted version covers anything more. $99 a month for someone else to host a scheduler is a hard sell when my token bill already hurts." (P024) |
| values | 1 | "If it's Apache-2.0 and runs on my own boxes, I'd self-host it and never pay for Cloud. I'd maybe try the free version, but Claude Code and GitHub Actions already cover most of the scheduled-agent stuff." (P029) |

## Why they buy

| reason | buyers | in their words |
| --- | ---: | --- |

## What would flip a no

- Seeing it reliably produce mergeable PRs overnight on a real agency repo, with approval gates our vendor tools can't do.
- Proof from a team like mine that most of the overnight PRs got merged without rework, and setup that takes under an hour.
- Proof of hard per-run quota and retry caps that kill a looping agent and ping me, plus a few months of other teams running it without incidents.
- Hard per-run and per-night token or retry caps that stop a run and ping my phone, shown working on our own repo during the setup call.
- If my cron setup broke for a week of nights and I saw a demo where approval gates and retries saved real review time compared with plain cloud agents.
- Hard spend and retry caps per run that stop a looping agent, plus proof from other agencies that it ran for months without surprises.
- Seeing it produce mergeable PRs on one of our internal repos for two weeks with the free self-hosted version, plus a clear story for client data and compliance.
- A client contract that explicitly allows agents only on our own hardware, plus proof that the morning PRs actually pass review more often than what our vendor agents produce.
- Seeing it handle retries, approval gates and the phone decision list much better than my script on a real repo, so I'd use the free self-hosted version first.
- Hard per-run token and retry limits that stop a run and alert me, plus a few weeks of the free version producing PRs we actually merge.
- A clear security model (sandboxing, scoped credentials, audit log) plus a few weeks of my own self-hosted runs producing PRs we actually merge.
- Seeing it run reliably for a few months at another agency, with retries and approval gates that clearly beat what the vendor schedulers already give me.

30 buyers gave all four price answers. Run founder-pricing's van_westendorp.py on the answers folder.
