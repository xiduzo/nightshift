# 29. The Gate queue has one order

Status: accepted, 2026-11-12. Built, 2026-11-12, in architecture series 3, lane L4
(e6f57bde, 007a1fa8). [ADR 21](0021-a-gate-has-a-brief-and-an-urgency.md) stays: it
gives a Gate its urgency, and this ADR orders the Gates of one urgency.

## Context

ADR 21 groups the inbox by urgency: Now, Today, When you have time. It does not say
which Gate comes first in one urgency. The inbox revamp of 2026-11-11 built that order
twice, two minutes apart:

- The phone's lane (dd259fd9) put the first to close first: the urgency, then the
  earliest deadline, then the oldest. Its tests pinned the order.
- The web's lane (58a17e58) put the oldest first in each urgency. DESIGN.md §2 and the
  wiki said so.

Neither commit gave a reason. So a person saw one order in the web inbox and another in
Needs you on the phone. After an answer, the phone offered the oldest Gate of the Host's
list, not the next Gate of its own list. A Gate for now could wait while the phone
offered a later one.

The Host sends the open Gates oldest first (`inboxOrder` in `engine/read/inbox.ts`). Two
Gates that opened at the same moment keep one order, by run and by step. The engine row
of STRUCTURE.md said that no screen sorts again. But both apps sorted by urgency.

## Decision

1. **One order for both apps.** The queue holds the Gates for now first, then for today,
   then for when you have time. In one urgency, a Gate with a deadline comes before a
   Gate without one, the earliest deadline first. The Gates without a deadline follow,
   the oldest first. Gates that tie keep the Host's order.
2. **The client owns the order.** `gateOrder` in `@nightshift/client` (`gates/queue.ts`)
   sorts the open Gates. The web inbox, Needs you and Watch on the phone read it. The
   order of the urgencies is `GATE_URGENCIES` of `@nightshift/flows`. A Gate without an
   urgency reads as `today` (`urgencyOf`), as ADR 21 says.
3. **The next Gate is the next one in the queue.** After an answer, the phone offers the
   next Gate in the queue order, not the oldest Gate.
4. **The Host keeps its order.** `gates.list` still sends the Gates oldest first. The
   apps sort them. The route and its reply do not change.
5. **Which Gates the queue holds stays per app.** The web inbox shows every open Gate,
   also a Gate that a viewer cannot answer and a Gate whose answer is on its way. Needs
   you shows only the Gates you may answer now (`mayAnswer`). The order is the same.

## Alternatives

- **The oldest first in each urgency, in both apps.** This was the web's rule. It is
  simple, and it is the Host's order. But a Gate whose deadline is ten minutes away
  waits behind an older Gate with no deadline. At the deadline, Night Shift picks for
  the person.
- **The Host sends the queue order.** One sort, and no screen sorts. But it changes the
  reply of `gates.list`. An app of a newer version on an older Host would show the old
  order again. A change of the order would also need a Host update first.

## Consequences

- In the web inbox, the count, the bars, Previous, Next and Skip for now follow the queue
  order. DESIGN.md §2 and the wiki page "Gates and the inbox" say so.
- The `needs_me` tool lists the Gates in the Host's order, oldest first, with the
  urgency of each. An agent reads the urgency itself.
- The web tab badge and the glance count the Gates with `waitingForYou`. It also counts a
  Gate whose answer is on its way, and `mayAnswer` does not. This ADR does not decide
  that count.
