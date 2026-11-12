# 27. A test run carries its pins and skips, the flow does not

Status: accepted, 2026-11-12. The engine, the read model and the API are
built. A Host start, a Walker move, the editor and the run views come next
([the record](../research/any-domain-2026-11.md), Q39).

## Context

A Builder who tests one part of a flow runs the whole flow again. An Agent
that worked for an hour works again. A Gate asks again. An approval Gate
sends, publishes or merges for real once a person answers it.

The editor shows the last output of each node already. TouchDesigner has
Lock (a node keeps its last output) and Bypass (a node lets its input
through). On 2026-11-11 the owner asked for the same ideas for testing (Q39).

The flags could live in two places: in the flow document, or in the start
of one run.

## Decision

1. **The start carries them.** A test run is a person's start of a saved
   flow with pins and skips (`StartRunInput.test`). A pin names a step of an
   earlier run (`runId`, `stepId`). A skip names an outcome. The flow
   document never holds them, so the flow format stays 9. Only the API's
   `runs.start` takes `test` (`startRunRequestSchema`). The schema of every
   other start stays without it.
2. **Only a person starts one.** Run start refuses `test` for a schedule, a
   webhook and a quick run. A start takes at most 50 pins and skips.
3. **The Walker resolves each pin from its own log.** The step must be of a
   run of the same project in the same Space, at the top level, of the same
   node, ended, and not skipped. A pin of a pinned step pins the output that
   step gave, and names the step it first came from. A pinned output holds at
   most 1 MiB of JSON. Once the plan has the flow, each node must be in it,
   have the type of the pinned step, and have the outcome. A refusal ends in
   what to do, for example "Pin a newer output."
4. **`RunStarted.test` records the outputs.** It holds each pin as
   `{runId, stepId, endedAt, outcome, outputs}` and each skip as its outcome.
   Event payloads travel as text, so every Replica keeps them as written. A
   Walker that takes the run over reads them from the log.
5. **A node stands in for itself.** At a visit at the top level, a pinned or
   skipped node runs a stand-in through the step runner. The step has
   `StepStarted.test` (`pinned` or `skipped`), and no Device, no timers and no
   rung. A pinned step gives the pinned outputs with its own visit. A skipped
   step gives its outcome, and each output field is null. The node's `set`
   writes apply, and the normal route follows. A stand-in costs nothing,
   scores nothing and opens no pull request.
6. **An End, a Join, a Lease and a Service always run.** An End ends the run.
   A Join waits for its branches. A Lease and a Service hold something for the
   steps after them.
7. **The plan places no stand-in.** The run's plan leaves the stand-ins out,
   and the flows that only they call. A pinned Agent needs no harness and no
   profile.
8. **A test run keeps nothing that lasts.** Its steps write no kept values, no
   memory of a Since last run node and no shapes. They still read them. Its
   cost counts. `RunSummary.test` names the pinned and skipped nodes.
   `StepSummary.test` and `pinnedFrom` say how a step stood in.

## Alternatives

- **Flags in the flow document (format 10).** Each Device and each Host
  would have to update first, because a Device refuses a flow of a newer
  format. A pinned output can be large. It would sit in every revision, in
  "Export as file", in the flows a person shares, and in what agents read of
  the flow. Every way a run starts would need a rule. A pin that a person
  forgot would change the runs of a schedule for days.
- **A Bypass that passes the input through.** A Night Shift node has no
  single input. A skip with an outcome says which way the run goes on.
- **Pin a typed value by hand.** A Value node made by a rule does that
  already.

## Consequences

- A pinned output restores the outputs of a step, not the files it changed.
  A step after it that reads those files finds them missing.
- A skipped approval Gate asks nobody. The steps after it run for real.
- A pinned node in a loop gives the same output on each visit. The step cap
  stops the run.
- A pinned branch always wins a Join that waits for the first branch.
- A Host's start of today drops `test` without a word. Until a Host takes a
  test run on its own procedure, a start in a Space that a Host keeps refuses
  a test run. A Walker move of a test run waits for the same check.
- An older phone or web app shows a stand-in as a step that ended at once.
