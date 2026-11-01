# Board summary: Night Shift

Date: 2026-11-01. Memos: [offers](board/offers.md), [monopoly](board/monopoly.md), [product](board/product.md). Brief: [brief](board/brief.md).

## 1. The vote

**3 fund if, 0 pass.** Average score **4.3 / 10** (Offers 4, Monopoly 4, Product 5).

All three members want the same proof before they fund. They do not agree on what Night Shift should become.

## 2. Risks that more than one member raised

1. **No proof beyond the founder.** One user, two weeks, no outside teams. Offers calls this low "likelihood of success" for the buyer. Monopoly says nothing shows a 10x gain over a script plus a vendor's background mode. Product says nobody has had to choose what matters. (All three.)
2. **The way in is too hard.** A new team must install a desktop app, log in to agent CLIs, maybe run a Host, pair computers and draw a flow, all before a first useful morning. Offers calls this effort and sacrifice. Product calls it the first five minutes. (Offers, Product.)
3. **The agent vendors control the ground.** Monopoly fears that Claude Code, Codex and others build scheduling, retries and review queues into their own products. Product fears that their CLIs change and break a night, and the customer then blames Night Shift. Same dependency, two failure modes. (Monopoly, Product.)
4. **Open source with no paid layer and no distribution.** No offer, no price, no pitch, no path to the first 100 teams. Apache-2.0 means anyone can fork it. (Offers, Monopoly.)

## 3. Conditions (merged checklist)

Proof
- [ ] At least **5 outside teams** run a real nightly flow for **4 weeks** (Offers wants 5 for 4 weeks, Monopoly 10 teams, Product 3 for 2 weeks; this list uses the strictest version that one builder can manage, and records the full 10 as the stretch goal).
- [ ] Measure per team: **merged-PR rate without rework**, gates answered, time saved. Compare with the team's script or vendor default, to show a **10x number** (or show that there is none).

The first night
- [ ] **One starter flow that works on the first night** for a common case (issue to draft PR, tests run, one gate). Claude Code only. No flow drawing and no Host setup.
- [ ] **Measure the first five minutes**: 3 developers who are not the founder go from install to their first kept PR. Record the time and each place they stop. Fix those places before any new feature.

Focus
- [ ] **Name the one thing in writing**: the morning inbox of pull requests and gates (Product). Freeze or hide what does not serve it until outside teams use it. Candidates: Offers, knowledge, extra agent families.
- [ ] **Name the small market**: for example, agencies that use two or more agent vendors. Size it. (`/founder-competitors`, `/founder-consumer`)

Business
- [ ] **A named paid offer on top of the open source**, for example a hosted Host, a done-for-you first flow and a guarantee ("a merged PR in your first week, or we build your flow"). Test the price with real teams. (`/founder-pricing`, `/founder-offer`, `/founder-cfo`)
- [ ] **Pick one lasting advantage and start it**: the strongest candidate is a shared library of flows and kits that gets better with each team (network effect). (Monopoly)
- [ ] **Distribution**: ship the pitch (README, one-page site, signed download) and know the cost to get each team. (`/founder-marketing`, `/founder-cfo`)

Open numbers nobody has: segment size, how many teams run agents overnight, how many use two or more vendors, willingness to pay, competitors and their prices, cost to get a team.

## 4. Where the members disagree

- **Neutrality: moat or not?** Monopoly sees vendor neutrality (one flow mixes Claude, Codex, local models) as the most defensible position, because no vendor will build it. Product wants to cut to **Claude Code only** for the first night. Both can hold: neutrality is the long-term position, and one agent keeps the first night simple. But the founder must choose which story leads.
- **Draw it, or just get the result?** Monopoly and Offers value the drawn flow as sticky team process. Product asks whether small teams want to draw pipelines at all, or only want the morning result from a ready-made flow.
- **Add, or remove?** Offers wants things added on top (hosted Host, done-for-you setup, a guarantee). Product wants surfaces removed. These conflict only if the additions come before the cuts.

## 5. The strongest version the board can see

The board does not see "a visual pipeline editor for agents" as the business. The canvas is a means, not what a team buys. The strongest version is **a morning inbox for small teams that use more than one coding agent**: you point it at a repo and a backlog, a tested starter flow runs overnight on your own logins, and in the morning you get pull requests plus a short list of decisions, on your desk or your phone. The core stays open source. Teams pay for a **hosted Host**, so they skip self-hosting and the phone works out of the box, and for help with their first flow. Over time, the shared library of flows and kits becomes the moat. This differs from the pitch in two ways: it leads with the result, not the drawing, and it treats most of what is already built (Spaces, Offers, knowledge, the assistant) as later layers, not the launch. That is a narrower product than the one in the repo, and the board says so plainly. None of it matters until outside teams prove that the morning is real.
