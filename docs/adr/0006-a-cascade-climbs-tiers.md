# 6. A cascade climbs tiers

Status: accepted, 2026-10-31

## Context

Flows climb from a cheap try to a strong one by hand. The
`implement-and-check` starter does it with edges: an Agent on Sonnet, a
check, back to the Agent (max 2), then a rescue Agent on Opus, then a
check of the rescue. Every flow of a client project repeats the shape. The
person draws four nodes and four edges for one idea: "try cheap first, and
climb when it does not hold".

Decision models such as Jev give a calibrated probability with each answer.
Night Shift shows the probability in the note and then ignores it. A small
model that knows it is unsure should hand the question on, not answer it.

## Decision

1. **A cascade is a field, not a node.** An Agent, a Decision by model, a
   Value by model and a Call can have a `cascade`. It is a list of tiers.
   The engine tries the first tier. When a try does not hold, the engine
   tries again in the same tier, up to `tries`, then goes to the next tier.
2. **The last tier can be a person.** Then the person gets what the tiers
   did and decides. Without a person tier, the step ends `fail` when the
   last tier does not hold.
3. **What a tier is, and when a try holds:**

   | Node | A tier names | A try holds when |
   | --- | --- | --- |
   | Decision by model | a Model Profile and `minConfidence` | the pick has at least that probability |
   | Value by model | a Model Profile and an optional `accept` rule | the data matches the schema and the rule holds |
   | Agent | an Agent Profile, `tries`, `session` | the agent ends `pass` and the node's `check` command exits 0 |
   | Call | a flow or a kit, its inputs, `tries` | the called flow ends `pass` |

4. **The person tier per node.** For a Decision, it is a Gate that shows
   each tier's pick and probability. For a Value, it is an Ask
   ([ADR 10](0010-a-value-can-ask-a-person.md)), filled in with the best
   answer. For an Agent or a Call, it is a Gate with "try again" (one more
   try on the last tier, with the person's note) and "stop". A person tier
   can have a deadline, as a Gate can.
5. **An Agent's `check`.** An Agent with a cascade can have a `check`: a
   command in the same copy of the project, run after each try that ends
   `pass`. The check is a command, not a model, so the engine decides
   whether a try holds.
6. **Each try knows the try before it.** `{{cascade.tier}}`,
   `{{cascade.try}}` and `{{cascade.previous}}` (the last try's summary,
   its outcome and the check's log tail) are template values. An Agent's
   next try gets the previous failure in its prompt without a template.
   A try in the same tier resumes the session when `session` is `resume`.
   A new tier starts a new session, because its harness can differ.
7. **The rest of the node stays.** The cascade replaces the node's
   `profile`, `decider` and `model`. Outcomes, edges, `ask`, `output` and
   timeouts work as before. Edges with `max` still work, outside the
   cascade.
8. **A Decision tier without a probability.** A decider that gives no
   probability (`ollama`, `compatible`) can only be the last model tier.
   Its pick always holds.
9. **The run shows the climb.** Each try is a visit with its tier. The run
   page shows the ladder. The step's outputs add `tier` (the label of the
   tier that held), `tries` and `confidence`. Budgets and `maxSteps` count
   every try.
10. **A resumed run continues the climb** at the tier and try where it
    stopped, not at the first tier.

A Section is not a unit of a cascade. To climb over a group of nodes, make
the group a flow and give the Call a cascade.

## Consequences

- `implement-and-check` becomes one Agent with a cascade (Sonnet, then
  Opus) and a check (`bun test`). The starter and the docs change with it.
- A Decision by model gets cheap: a free model on the Host answers what it
  is sure of, and only the rest goes to a stronger model or the inbox.
- The thresholds need tuning. The run record keeps the tier that held and
  its probability, so a person can read the history and move a threshold.
- The engine walks a cascade inside the step. The graph does not change,
  so the validator's loop rules do not change.
