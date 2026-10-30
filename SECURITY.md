# Security

Night Shift runs coding agents on your computer with your own logins, and it can run shell commands from a flow. Take security problems seriously, and report them privately.

## Report a problem

Do not open a public issue. Use [**Report a vulnerability**](https://github.com/xiduzo/nightshift/security/advisories/new) on the Security tab. Tell us:

- what an attacker can do,
- the steps to reproduce it,
- the version or commit you tested.

The maintainer answers as soon as possible.

## Supported versions

Night Shift is pre-alpha. Only the latest commit on `main` gets fixes.

## What counts

For example:

- A flow file, a template value, or an agent's output that runs shell code it should not.
- A secret or a token that leaves the computer it belongs to, or shows in the UI or a log.
- A Host that lets someone in without an invitation, or lets a person read another Space.
- A run that uses another person's agent profile without an Offer, or in a wider permission mode than the Offer allows.
- A webhook that starts a run or wakes a Wait without the schedule's secret.
- A paired computer or a phone that acts for a person it does not belong to.

## Known dependency findings

`bun audit` on 2026-10-30 lists 30 findings in packages that other packages pull in: 12 high, 15 moderate, 3 low. Night Shift does not pin or override them. Each goes when the package that pulls it in updates. The unattended surface is the daemon and the Host: the API, webhooks, the runs and the pushes it sends. Each high finding:

- **zod** (below 4.6.6, high): memory use while validating very large collections. Our own code and Better Auth check every API request and webhook body with zod 4, which is 4.6.7 since 2026-10-30, so this no longer reaches the unattended surface. The finding stays for zod 3.25, which the shadcn and Expo CLIs and `pi-acp` bring. None of them checks a request to Night Shift.
- **undici 7** (below 7.30.1, four high): `expo-server-sdk` sends the Host's phone pushes with it, to Expo's push service only, over `fetch` with no cache and no custom TLS options. The DoS findings need a malicious push service. `shadcn` and `@dotenvx/dotenvx` also pull it in, for the shadcn CLI during development.
- **undici 8** (below 8.12.2, four high): `jsdom`, for the web app's tests only. Not in a build.
- **body-parser** (2.0 to 2.3, high): `express`, through `@modelcontextprotocol/sdk`. Night Shift runs MCP over stdio and in memory, and never loads the SDK's Express server.
- **node-forge** (up to 1.4.0, high): `@expo/cli`, which builds the phone app. Not in the daemon or the app.
- **systeminformation** (below 5.33.16, high, Windows only): `@dotenvx/dotenvx`, through the shadcn CLI. A development tool, not in a build.
