# 9. A service lives for its scope

Status: accepted, 2026-10-31

## Context

Some steps need a process that keeps running while other steps work: a
Docker Compose stack, a dev server, a local cluster, a preview deploy, a
local model server. Flows start one with a Command that ends with `&`, wait
for it with a polling Wait, and stop it with a last Command. When a step
fails or a person stops the run, the last Command never runs. The stack
stays up, holds its ports, and fills the disk. The next run then fails on
the ports.

## Decision

1. **A Service node starts a process and leaves it running.** `start` is a
   command that runs in the background in the run's copy of the project.
2. **It is ready when its probe says so.** `ready` is a command or a URL,
   tried every `everySeconds` up to `timeoutMinutes`. Outcomes: `ready` and
   `failed`. A `ready` command can write data to `$NS_OUTPUT`, for example
   the URL and the port, which later steps read as `{{stack.data.url}}`.
3. **It lives for its scope.** The scope is the run (the default) or a
   named Section. When the run leaves the scope, the engine stops the
   service: with the `stop` command when the node has one, else by ending
   the process group.
4. **The engine always stops it.** On done, failed, stopped, a failed step,
   and a daemon restart. The daemon records each running service. After a
   restart it stops the services of runs that do not continue.
5. **A resumed run starts it again.** A run that resumes inside the scope
   runs `start` and `ready` again. It does not assume that the old process
   still lives.
6. **The log stays readable.** The run page shows the service's log.
   `{{stack.log_tail}}` gives later steps the last lines, for example to
   explain a failed test.
7. **One Device.** A service runs on the Device of its step. Every step in
   its scope must run on the same Device. The validator gives an error when
   a step in the scope is placed elsewhere.

A service with a fixed port goes inside a Lease
([ADR 7](0007-a-lease-keeps-one-run-at-a-time.md)) on that port.

## Consequences

- A flow that tests against a local stack is: Lease, Service, the tests,
  and nothing to clean up by hand.
- A kit per project can bring up its stack, for example a `zac/stack-up`
  flow. The kit's flow holds the commands, and the engine holds the
  life cycle.
- A Service is not a deploy tool. A process that must outlive the run
  belongs to a deploy, not to a flow.
