# 21. A Gate has a brief and an urgency

Status: accepted, 2026-11-11.

## Context

The inbox showed a Gate as its title, its question and its options. A person had to
read the run to know why the Gate asks, what the run already did, and which option
is safe. Every Gate also looked equally urgent. A Gate that blocks a release and a
Gate that asks for a name of a branch sat side by side, oldest first.

The inbox revamp asks four questions of each Gate. Why must a person decide? What
is already decided, checked or done? Is there a preferred option? What does each
answer do? It also groups the inbox by how soon a Gate needs an answer.

## Decision

1. **Three urgencies.** A Gate is `now`, `today` or `later`. The inbox labels are
   "Now", "Today" and "When you have time". A Gate without one is `today`.
2. **The flow writes the brief first.** A Decision by a person, the person tier of a
   cascade and an Ask (a Value by a person) take optional fields: `urgency`,
   `situation`, `background`, `recommend` (a Decision only) and `fillBrief`. Each
   option of a Decision takes `impact`. All take templates. The fields are optional,
   so the flow version stays the same.
   - A literal urgency that is not one of the three is a check error. A template
     that renders to anything else is left out.
   - A `background` line that starts with `- ` is one item. An item may end with
     ` (source: X)`, the source of the fact.
   - A literal `recommend.option` must be an option. A rendered one that is no
     option is left out.
   - The fields on a node that no person answers are a check error.
3. **The engine fills what it knows.** The person tier of a cascade without the
   flow's words gets a background of what each tier picked and how sure it was, and
   recommends the pick of the surest tier.
4. **A model fills the rest.** When `fillBrief` is not `false` and a part is still
   empty, one structured call writes the missing parts as the Gate opens. It reads
   the title and question, the options, what the flow already says, and the earlier
   steps of the run (at most 12 000 characters, newest first). It goes through the
   decider path of a Value by a model. The author's text always wins. The parts the
   model wrote are named in `byModel`, so the inbox can say so.
5. **The model never blocks the Gate.** The call has one minute. No decider that
   makes values, an error or no answer in time, and the Gate opens with what it
   has. Its cost goes on the Gate's step (`GateOpened.briefCostUsd`).
6. **An Agent writes its own brief.** An Agent that asks a person gives the same
   parts with its `needs-input` report (`ask` on `report_step`). No extra model call.
7. **The brief travels with the Gate.** `GateOpened` carries `urgency`, `brief` and
   the impacts on its choices. It writes them only when there is something to say.
   An older log, or a Gate with nothing to say, reads as `today`, set by default,
   with an empty brief. An answered Gate keeps its urgency. The read model, the
   `gates.list` API, the client and the `needs_me` tool serve the same shape. The
   landed fact of an opened Gate carries the urgency, so a push can depend on it.

## Alternatives

- **Only a model writes the brief.** Every Gate gets a brief without work from the
  author. But a model guesses at urgency and at what is safe, and the author often
  knows better. An earlier step (a triage, a review) often has the exact answer. A
  Gate would also cost a model call every time, and a person could not turn it off.
- **Only the author writes the brief.** No cost and no guesses. But most flows have
  Gates with no brief today, and an author rarely writes all five parts. The inbox
  would stay empty where it matters.

Author first, then a model for the gaps, keeps the author's knowledge, fills the
rest, and lets an author turn the model off per Gate.

## Consequences

- The decider for the brief is the Device's default for a Value by a model
  (OpenRouter and its default chat model). The default for a Decision by a model is
  TypeSafe, which cannot answer with data, so it cannot write a brief. A Device
  without a value decider opens its Gates without the model's parts.
- A Gate opens up to one minute later when the model is slow. A deadline in
  minutes counts from before the model call.
- The prompt holds the outputs of earlier steps. It goes to the same decider a
  Value by a model of that run would use.
