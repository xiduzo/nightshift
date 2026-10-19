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
