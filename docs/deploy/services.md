# A stack for the steps of a run

Some steps need a process that keeps running while other steps work: a
Docker Compose stack, a dev server, a local cluster or a model server. A
Service node starts it, waits until it is ready, and leaves it running.
Night Shift stops it when the run leaves the node's scope, however the run
ends. The flow has nothing to clean up.

The decision is recorded in
[ADR 9](../adr/0009-a-service-lives-for-its-scope.md).

## What a Service node does

1. It runs `start` in the background, in the run's copy of the project,
   in a process group of its own.
2. It tries `ready` every `everySeconds` (default 2), up to
   `timeoutMinutes` (default 5). `ready` is a `command` that exits 0, or a
   `url` that answers with a 2xx status.
3. When the check passes, the step ends `ready`. When the service ends
   with an error first, or the time runs out, the step ends `failed`, and
   Night Shift stops the service.
4. When the run leaves the scope, Night Shift runs `stop`. A node without
   `stop` gets its process group ended. The scope is the run (the default),
   or a Section that holds the node (`scope: { section: "tests" }`).

Night Shift also stops the service when a person stops the run, when a
step fails, and after a restart of Night Shift when the run does not
continue. A run that resumes inside the scope starts the service again
and waits until it is ready before its next step.

Later steps read two outputs:

- `{{stack.data}}`: the JSON that the ready command wrote to
  `$NS_OUTPUT`, for example `{{stack.data.url}}`.
- `{{stack.log_tail}}`: the last lines of the service's log, as they are
  when the step starts. Give it to an agent that explains a failed test.

The run page shows each service of the run, and its log.

## Example: a Docker Compose stack

This flow takes a Lease on the stack's ports, starts the stack, runs the
tests against it and asks an agent to explain a failure.

```json
{
  "nodes": [
    { "id": "ports", "type": "lease", "name": "zac-docker-stack", "waitMinutes": 60 },
    {
      "id": "stack",
      "type": "service",
      "start": "docker compose -p zac-e2e up -d",
      "ready": { "url": "http://127.0.0.1:8080/health", "everySeconds": 5, "timeoutMinutes": 10 },
      "stop": "docker compose -p zac-e2e down -v"
    },
    { "id": "tests", "type": "command", "command": "BASE_URL=http://127.0.0.1:8080 bun run test:e2e" },
    {
      "id": "explain",
      "type": "agent",
      "prompt": "The end-to-end tests failed.\n\n{{tests.log_tail}}\n\nThe server log:\n\n{{stack.log_tail}}\n\nFind the cause."
    }
  ],
  "edges": [
    { "id": "e1", "from": "ports", "outcome": "held", "to": "stack" },
    { "id": "e2", "from": "stack", "outcome": "ready", "to": "tests" },
    { "id": "e3", "from": "tests", "outcome": "fail", "to": "explain" }
  ]
}
```

The node positions and the other fields of a flow are left out. Some
notes:

- `docker compose up -d` exits once the containers run. That is fine: the
  ready check decides when the stack is ready, and `stop` takes it down.
- The stack uses fixed ports and a fixed project name, so the Lease lets
  one run at a time use it.
- Check an address that only answers when the stack is ready. A container
  that runs is not yet a server that answers.

A stack on a free port tells later steps its address through a ready
command. This check passes when the server answers, and writes the address
as the step's data:

```sh
port="$(docker compose -p zac-e2e port web 8080 | cut -d: -f2)"
curl -fs "http://127.0.0.1:$port/health" > /dev/null &&
  printf '{"url": "http://127.0.0.1:%s"}' "$port" > "$NS_OUTPUT"
```

A later step reads it as `{{stack.data.url}}`.

## Limits

- Every step in the scope runs on the service's computer. The flow check
  gives an error when a step names another device, and a run does not
  start when it would place such a step elsewhere.
- A resumed run starts the service again with the commands it had at the
  first start. Later steps keep the `data` of that first start.
- A service is not a deploy. A process that must outlive the run belongs
  to a deploy, not to a flow.
- The log of a service is on the computer that runs the run. The run page
  of another computer does not show it.
