# 11. Night Shift sends anonymous usage by default

Status: accepted, 2026-11-01

## Context

Night Shift needs usage numbers from people other than its builder. The
monitoring export does not give those numbers. The person chooses the
endpoint for that export. The export is not anonymous. A span can carry a
flow name, a project id, a node id and free text. A person can guess a
short name from its hash.

Anonymous usage is a separate export. The default is on. The monitoring
export stays opt-in and off by default. Night Shift does not send the
monitoring export to its own server. Some buyers request no network access
by default.

## Decision

1. **Anonymous usage is on by default.** Night Shift sends anonymous usage
   by default. The monitoring export stays opt-in and off by default. The
   monitoring export is not anonymous. Night Shift does not send the
   monitoring export to its own server.
2. **Allowlist.** Night Shift sends only events and fields that the
   registry lists. It sends no free text, names, paths, URLs, prompts,
   commands, emails, host names, error text, flow names or node labels. It
   sends `_OTHER` for a value that the list does not contain.
3. **Ids.** Night Shift hashes an id that leaves with HMAC-SHA256. The key
   stays on this computer. Night Shift keeps 16 characters of each hash.
4. **Coarse values.** Night Shift rounds each cost to a whole cent. Night
   Shift rounds each time to the second, except the event time. Night Shift
   rounds each event time to the minute.
5. **The server checks the allowlist.** The server checks each event
   against the registry a second time. It refuses an event or a field that
   the registry does not list. The server stores no IP address. The server
   can store the country from `CF-IPCountry`.
6. **A person can set usage to off.** The Settings switch is on by default.
   A Space admin has a switch that sets anonymous usage to off for every
   computer in the Space. Any one of `DO_NOT_TRACK=1`, `NIGHTSHIFT_USAGE=off`
   or `OTEL_SDK_DISABLED=true` sets usage to off. An environment value
   overrides the setting.
7. **The first start shows a notice.** On the first start, Night Shift
   shows a notice before the first event leaves this computer. The notice
   has the switch and a link to the field list.
8. **Settings shows the batch.** Settings → Monitoring shows the events that
   wait to send. It shows the last batch as the JSON that this computer sent.
9. **A Host container sends usage.** A Host container sends anonymous usage
   by default. The compose file comments show `NIGHTSHIFT_USAGE=off`.
10. **A command step has its own span.** A Step of a Command Node is a span
    named `nightshift.step`. That span is not a GenAI `execute_tool` span.
    An agent tool call stays an `execute_tool` span.
11. **Postgres stores the data.** Night Shift stores the received data in
    Postgres. Night Shift publishes no public page of aggregates until 5
    installs send data.
12. **The build sets the endpoint.** Night Shift has no domain yet for
    ingest or the admin app. The build sets the ingest endpoint.

## Consequences

- A secret never leaves the Device it is on. A session, a worktree and a
  token stay on the person's computers.
- A step that sends other data off the machine says so in its node.
  Anonymous usage is not such a step.
- The server cannot recover a name from a hashed id. The key stays on this
  computer.
- A person can read the last batch. Settings → Monitoring shows that JSON.
