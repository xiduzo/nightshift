# 7. A lease keeps one run at a time

Status: accepted, 2026-10-31

## Context

Runs of different flows touch the same things. A flow that fixes red pull
requests rebases one layer of a stack while another run, or a person,
pushes the layer above it. The stack then looks right on one computer and
wrong on GitHub. Flows protect themselves with `--force-with-lease` and
hope. Two runs that start the same local Docker stack fight over its
ports. A Mac with one large model in memory can serve one heavy run at a
time.

A command cannot hold a lock well. It cannot release the lock when a person
stops the run, when the step fails, or when the computer restarts.

## Decision

1. **A Lease node takes a named lease.** The name is a template, for
   example `branch:{{pr.data.head}}` or `zac-docker-stack`. Only one run of
   the Space holds a name at a time.
2. **The Home Host keeps the leases.** Runs on different Devices of one
   Space exclude each other. A Device without the Host waits for it, as
   other Space work does ([ADR 1](0001-one-personal-space-per-home-host.md)).
3. **Outcomes: `held` and `busy`.** The node waits for the lease up to
   `waitMinutes` (0: do not wait). It ends `busy` when the time runs out.
   The `busy` outcome names the run that holds the lease.
4. **The engine releases it.** A lease holds until the run leaves its
   `scope`: the end of the run (the default), or the exit of a named
   Section. The engine releases it on every end: done, failed, stopped,
   or a step that fails. A Section, here, only marks where the scope ends.
5. **A lease cannot outlive a lost run.** The holder renews it while the
   run lives. When the holder's Device is gone longer than `ttlMinutes`
   (default 30), the lease expires. A run that resumes takes its leases
   again before its next step.
6. **People see leases.** The run page shows the leases a run holds and
   waits for. A person can release a lease by hand.

## Consequences

- A flow that changes a branch wraps the change in a Lease on the branch.
  Two flows on one stack take turns. The desync of stacks goes.
- A schedule that fires often ends `nothing-to-do` on `busy`, through an
  End node, instead of starting the same work twice.
- Leases are Space data. They do not work across Spaces. That is on
  purpose: a Space is one person's computers.
