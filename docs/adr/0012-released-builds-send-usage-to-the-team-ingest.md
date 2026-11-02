# 12. Released builds send usage to the team ingest

Status: accepted, 2026-11-02. Replaces item 12 of
[ADR 11](0011-night-shift-sends-anonymous-usage-by-default.md).

## Context

ADR 11 let the build set the ingest endpoint. Only the Docker image had a
build arg for it. The desktop app and the `nightshift` binary had none.
Those builds sent no usage, and they are most of the installs.

The team ingest now has a domain: `https://ingest.xiduzo.com/nightshift`.

## Decision

1. **The endpoint is in the code.** `usageEndpoint()` in
   `@nightshift/telemetry` holds the team ingest as its default.
2. **A released build sends to it.** A build sets `NIGHTSHIFT_VERSION`: the
   desktop app, the binary and the image. With a version and no endpoint
   of its own, Night Shift sends to the team ingest.
3. **A run from source sends nothing.** Without `NIGHTSHIFT_VERSION`, the
   default does not apply. A development daemon sends no usage.
4. **A chosen endpoint wins.** A non-empty `NIGHTSHIFT_USAGE_ENDPOINT`
   replaces the default. An empty value does not turn usage off.
5. **The off switches stay.** The Settings switch, the Space switch,
   `NIGHTSHIFT_USAGE=off`, `DO_NOT_TRACK=1` and `OTEL_SDK_DISABLED=true`
   still stop every send. The first-start notice still comes first.

## Consequences

- Every released build sends anonymous usage by default.
- A build made on a laptop sets the version `0.1.0`. It sends too, with
  that version.
- The image build arg and the repository variable are optional. They can
  point the image at another ingest.
