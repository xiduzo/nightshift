# 24. A retired usage name stays accepted while old builds send it

Status: accepted, 2026-11-11.

## Context

Every released build sends anonymous usage events
([ADR 11](0011-night-shift-sends-anonymous-usage-by-default.md),
[ADR 12](0012-released-builds-send-usage-to-the-team-ingest.md)). The ingest
checks each record against the registry of its own build (ADR 11, item 5). It
refuses the whole record when the event or one of its fields is not in that
registry. A person updates Night Shift when they choose. So for weeks the
ingest gets records from older and newer builds at the same time.

Night Shift now uses one plain vocabulary for every domain. The events
`nightshift.pull_request.opened`, `nightshift.pull_request.outcome` and
`nightshift.pull_request.useful` give way to one event, `nightshift.run.scored`.
The metric `nightshift.pr.outcome` gives way to the `nightshift.score` points
of the same names. When the registry drops an old name at once, the ingest
refuses every record of an older build that sends it. Insights then loses
those runs, and its history no longer means the same.

## Decision

1. **A retired name stays in the registry, deprecated.** A retired event or
   attribute keeps its entry with `deprecated` (`reason: obsoleted`) and a
   note. Weaver checks it as before, and the generated schema still accepts
   it.
2. **The code names it apart.** `USAGE_EVENT` lists only the events this
   build sends. `RETIRED_USAGE_EVENT` lists the retired events. A test proves
   that each event of the registry is in one of the two lists, never both.
3. **A newer build never sends a retired name.** It sends the name that
   replaced it.
4. **The ingest accepts both.** The Collector allowlist keeps the retired
   keys, because its check reads the generated schema.
5. **Insights reads both as one.** The fact view maps a retired event to the
   name that replaced it. A useful answer from an older build and one from a
   newer build count as one answer per run. The latest answer counts.
6. **A retired name leaves when no older build sends it.** The Mix page of
   Insights lists the versions that send events. When no version older than
   the retirement sends events, a later change removes the entries, their
   allowlist keys and the mapping in Insights. That change also decides what
   happens to the stored history: a data migration to the new names, or rows
   that the views no longer read.
7. **The ingest deploys first.** A change that adds an event, a field or a
   value deploys the Collector allowlist and Insights before any release that
   sends it. An older ingest refuses the whole record.
8. **The export to monitoring has no such grace.** A person's monitoring reads
   what their own build sends, and no shared ingest sits between. A retired
   metric goes at once, with a line in `docs/deploy/monitoring.md` and in the
   release notes.

## Alternatives

- **Drop the old names at once.** The registry stays short. But the ingest
  refuses every record of an older build that sends one. The team loses the
  data of each person who has not updated yet.
- **Accept unknown events and fields at the ingest.** Nothing to retire. But
  the allowlist is the privacy contract of ADR 11: the server refuses what the
  registry does not list. An open ingest stores whatever a changed build sends.
- **Keep one schema per build version at the ingest.** Each record is checked
  against the registry of the build that sent it. That is exact, but the
  ingest then needs every registry ever generated, and Insights needs a
  mapping per version.

## Consequences

- The registry holds retired entries for some weeks. Their notes say why.
- `review-pr`, a starter that no build ships, stays a member of
  `nightshift.flow.starter` for the same reason.
- The Grafana dashboard reads pull request outcomes from `nightshift.score`.
  A person's own dashboard on `nightshift_pr_outcome_total` goes empty after
  the update.
- A run's log keeps `pr_useful` as written, because the log is never
  rewritten. Night Shift reads it as `useful` for good. That alias is in the
  log, not in the usage names, so it never expires.
