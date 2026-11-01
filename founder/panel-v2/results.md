# Buyer panel: Night Shift: open-source app that runs a team's coding-agent pipelines overnight on their own computers and logins

**0 buy · 20 pass** (0% buy) out of 20 simulated buyers. Seed 960871, so the same cards can be dealt again.

These are simulated buyers, not customers. Use this to find objections and weak spots, then confirm the big ones with real people before you spend.

## By segment

| group | buyers | buy rate |
| --- | ---: | ---: |
| Tech lead at a small digital agency | 9 | 0% |
| Senior developer who picks the tools for a small team | 4 | 0%  (thin) |
| Owner or managing director of a small agency who holds the budget | 5 | 0%  (thin) |
| Founder or CTO of an early-stage startup | 2 | 0%  (thin) |

## By buying behaviour

| group | buyers | buy rate |
| --- | ---: | ---: |
| Vendor default is good enough | 5 | 0%  (thin) |
| Burned by background agents | 2 | 0%  (thin) |
| Scripts it themselves | 2 | 0%  (thin) |
| Watches every subscription | 3 | 0%  (thin) |
| Tool tinkerer | 3 | 0%  (thin) |
| Waits for proof from others | 3 | 0%  (thin) |
| Open source and self-host first | 2 | 0%  (thin) |

## By income

| group | buyers | buy rate |
| --- | ---: | ---: |
| under $98,000 | 6 | 0%  (thin) |
| $98,000 to $113,000 | 7 | 0%  (thin) |
| $113,000 and up | 7 | 0%  (thin) |

## Why they pass

| reason | buyers | in their words |
| --- | ---: | --- |
| trust | 13 | "I already threw away most of the PRs background agents opened for us, and a pre-alpha tool from one developer doesn't change what the agent writes. Maybe I'd poke at the free self-hosted version on a slow Friday, but I'm not paying $99 a month for it." (P002) · "The budget and loop guard speak directly to my fear, and the free self-hosted version on my spare Mac mini costs me nothing to try. But it is pre-alpha from one developer, so I would tinker with the free version before I pay $99 a month for anything." (P004) |
| habit | 6 | "We already get scheduled agent runs from Claude Code and GitHub as part of what we pay for. I would not add another tool and another bill for the same thing." (P001) · "I already have a cron job calling claude -p and I'd rather add a budget check to it than adopt a pre-alpha tool from one developer. The budget and loop guard are the interesting part, but I can script those myself in an afternoon." (P003) |
| quality | 1 | "I'd self-host the free version before paying for Cloud, so the $99 isn't for me anyway. And my problem with background agents was never scheduling, it was PRs not worth reviewing, and nothing here says the output gets better." (P017) |

## Why they buy

| reason | buyers | in their words |
| --- | ---: | --- |

## What would flip a no

- A clear demo where it reliably ships tested PRs overnight that our vendor scheduling cannot, plus some proof it will still exist in a year.
- Seeing that a team like mine actually merges most of the overnight PRs without rewriting them, for example a real merge rate over a few weeks.
- A few months of public use with proof the budget and loop limits actually stop runs, plus a way to import my existing scripts as a flow. Then I might self-host the free version.
- A few weeks of the free version on my Mac mini that show the cost caps really stop runs, plus a second maintainer or a few agencies like mine using it.
- Seeing it reliably beat my cron setup for a few weeks, with the approval step and cost caps actually saving us from bad overnight runs.
- A few agencies like mine running it on real client work for a couple of months, with proof the budget stop actually held.
- Proof from another agency that most overnight PRs actually got merged, plus a clear answer I can show clients about where their code goes.
- A clear case where the vendor scheduling fails us, like budget overruns or runs looping overnight, plus a few named teams running it in production for months.
- If a peer at another agency showed me it reliably producing mergeable PRs every week, I might self-host the free version and try it. I still wouldn't pay $99 for hosting.
- A few weeks on the free version where the budget caps actually hold and the morning PRs get merged without rework. After that I'd pay for the hosted server.
- A clear sandboxing story (no network or secrets access by default, reviewed permissions per flow) plus a few months of other agencies running it in production without incidents.
- Seeing it run for months on a team like mine and save real hours each week compared with the vendor's own scheduling, with no setup cost to try the self-hosted version.

20 buyers gave all four price answers. Run founder-pricing's van_westendorp.py on the answers folder.
