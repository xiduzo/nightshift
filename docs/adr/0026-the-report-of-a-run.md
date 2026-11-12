# 26. The report of a run

Status: accepted, 2026-11-12. The format, the engine, the read model and the API
are built. The web and phone screens come next
([the record](../research/any-domain-2026-11.md), Q15, Q21, Q38).

## Context

Night Shift now serves any domain. A flow for research or monitoring produces
text that a person reads: what is new, what changed, what the agents found. A
flow for code produces a pull request, which already has a home on GitHub. The
other flows had no home for their result. The text stayed in a step's
transcript or in an artifact on one Device.

An End node ends a run with a result (`done`, `nothing-to-do`, `failed`) and
one line (`message`). The runs list, the run page and the finished-run push
show that line. One line is too short for a result.

On 2026-11-11 the owner decided that a run can end with a report. It shows on
the run page, on the flow's card and on Home. Night Shift never pushes it, and
the digest stays removed (Q15, Q21). A Gate's urgency, not a Notify node,
decides what pushes (Q38).

## Decision

1. **The End node writes the report.** It takes an optional
   `report: { kind: "text", text }`. The text is a template that renders to
   Markdown. The union stays open: a later kind reads the report from a file
   the run wrote.
2. **The End step's outputs keep it.** The report is the output `report` of the
   End step (`StepEnded.outputs`). It replicates like any other output. There
   is no new event, no artifact, and no change to `RunEnded`. The flow format
   stays 9, because the field is additive.
3. **The cap is 64 KB.** A report keeps at most `MAX_REPORT_BYTES` (64 KB in
   UTF-8), the same cap as the memory of a Since last run node. A longer report
   is cut at the last line break within the cap, never inside a character. The
   step then logs a warning of the kind `report`, and the transcript's `end`
   entry says `report: { cut: true }`.
4. **The run's report is the report of the End that ended the run.** That is
   when an End node ended the run (`RunEnded.result`). The report is that of
   the newest End step of the run's own flow that ended at or before the run's
   end. A rerun that ends at another End replaces it. A run that failed,
   stopped or ended any other way has none.
5. **A summary carries only a glance.** `RunSummary.report` is the End step, at
   most 600 characters of the Markdown cut at a line break, and whether there is
   more. The full text stays in the step's outputs (`RunDetail.steps`). Derived
   views outlive the logs that the run log drops, so they never hold the full
   text. The dashboard gives the newest report per flow of the runs that
   started in a range of days (`NightsRange.reports`). A Flow health row gives
   the flow's newest report of any day (`FlowHealthRow.report`).
6. **A Subflow passes the report on.** A Subflow node without `each` gives the
   report of the End its flow ended at as `end_report`, next to `ended` and
   `end_message`. A Subflow with `each` gives none, to keep its outputs small.
   Only the report of the run's own flow counts for the run, the flow's card
   and Home.
7. **Night Shift never pushes a report.** The notifications do not change. The
   finished-run push stays "A run finished". The MCP `get_run` tool may return
   the report, because a person or an agent asks for it.

## Alternatives

- **An artifact.** An artifact stays on the Device that ran its step and never
  replicates. A Host or a phone could not show the report of a run that a
  laptop walked.
- **A new event (`RunReported`) or a field of `RunEnded`.** A new event type
  needs a new reader on every Replica. The step's outputs already replicate,
  and the rule of decision 4 finds the step without an event change.
- **The full text in the run summary.** The run list and the dashboard read
  summaries of hundreds of runs. A 64 KB text in each would make every list
  heavy, and derived views would keep it after the log is dropped.

## Consequences

- An End event of up to 64 KB replicates to every Replica of the Space. A
  Subflow's `end_report` copies it once more. The run log's idle budget counts
  events, not bytes, so the memory it keeps can grow (PLAN, run log).
- A Walker of an older build drops `report` from the End node without a word:
  the run ends without a report.
- An older Host's API refuses the warning kind `report`. The Host updates first,
  as for the warning kind `shape`.
- Every Member who can read the run reads its report, on the web and on the
  phone. Agents often write it from web content. So the screens show raw HTML
  as text and an image as a link: nothing loads from another server.
- Every new API field is optional. A screen hides the report when an older Host
  sends none.
