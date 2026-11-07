# Runs and schedules

## Start a run

- **Run** in the flow editor starts the flow. The start dialog asks for its inputs and the branch to start from.
- **Quick run** on a project starts one Agent from a prompt, with no flow. It can also pick a flow, with the most used flows first.
- A [schedule](#schedules) or a [webhook](#webhooks) starts a run without you.
- An agent in a terminal starts a run with the `start_run` tool. See [Terminal and MCP](Terminal-and-MCP.md).

Each run works in its own copy of your project, on a branch named `nightshift/…`. Your checkout stays clean. A run on a branch starts from its newest commit on the remote. When the local branch has commits that the remote does not have, the local branch wins.

You follow each step live: its transcript, the files that it changed, its cost, and its tokens.

## Stop and resume

- **Stop** a run now, or after the step that runs now.
- **Resume** a stopped, failed, or interrupted run at its last step. You can resume it from any computer of its Space. A viewer cannot resume a run.
- A run that a restart interrupted resumes by itself a few seconds after Night Shift starts again, unless its [run policy](#run-policy) says to wait for you.

## Schedules

A schedule starts a flow with its inputs at a time of day or on a cron line, for example `0 22 * * 1-5`. It stops the run at its stop time, for example 07:00.

- **The Host runs every schedule.** In a Space without a Host, this computer runs them. A step still runs on the computer that its node names.
- **A missed time still starts** within the schedule's late window. The default window is 15 minutes, and it can be up to 7 days. The run gets the time it was due as `{{run.due_at}}`.
- **Past the late window,** Night Shift skips the time and tells the people of the Space that the schedule did not start.
- **One run at a time.** A schedule does not start while its last run still runs.
- **Pause tonight** and **Run now** are on the phone too.

A Host without a copy of the project refuses the start. The schedule shows why. When you leave a Host, Night Shift pauses every schedule that is on, because the Host still runs them.

## Webhooks

A schedule can start when a webhook arrives, in place of a time. Use it to start a flow from GitHub Actions, n8n, Zapier, or a script. A webhook can also wake a Wait with a signal, for example when CI is done.

Each webhook schedule has its own address and a secret. Night Shift accepts a request only with a valid signature (`X-Hub-Signature-256`) or with the secret as a bearer token. See [Start a flow from another tool](https://github.com/xiduzo/nightshift/blob/main/docs/deploy/triggers.md).

## Run policy

The policy of a flow keeps a night safe. A value that the flow leaves out comes from **Settings → Run policy** of the computer.

| Limit | What it does |
| --- | --- |
| Budget | The run stops as failed when its known cost passes an amount in USD. A resume may spend as much again. |
| Turns | An Agent step fails when one session takes more model replies than this. |
| Idle | An Agent step fails when it does nothing for this long. |
| Steps | The run stops after this many steps, so a loop cannot run forever. You can resume it. |
| Usage limit | The step waits, then continues the same session. Without a known reset time, it waits 5 minutes first, then twice as long each time, up to 60 minutes. |
| Network | The longest time a step waits for the network before it fails. The default is 240 minutes. |
| Resume after a restart | A run that a restart stopped continues by itself, or waits for you. |

## When a computer goes offline

A computer that goes offline does not end the run:

- A step with a [backup](Agents-and-profiles.md#backups) moves to the first backup that can take it.
- A step without a profile moves to the next computer of the run that can take it.
- Otherwise the step waits for its computer until the stop time, and Night Shift tells you.

## Flow health

Flow health shows each flow's runs per night, their cost against the median, why runs failed, and the scores that its commands gave. A Command scores a run with `{"scores": {"coverage": 81}}` in its data. See [Command](Flows-and-nodes.md#command).
