# Runs and schedules

## Start a run

- **Run** in the flow editor starts the flow. The start dialog asks for its inputs. In a project with a folder, it also asks for the branch to start from.
- **Quick run** on a project starts one Agent from a prompt, with no flow. It can also pick a flow, with the most used flows first.
- A [schedule](#schedules) or a [webhook](#webhooks) starts a run without you.
- An agent in a terminal starts a run with the `start_run` tool. See [Terminal and MCP](Terminal-and-MCP.md).

Each run works in its own copy of your project, on a branch named `nightshift/…`. Runs do not change the files in your folder. A run on a branch starts from its newest commit on the remote. When the local branch has commits that the remote does not have, the local branch wins.

A run of a project without a folder starts in an empty folder of its own, with no branch. See [The files of a run](#the-files-of-a-run).

You follow each step live: its transcript, the files that it changed, its cost, and its tokens.

When a run finishes, the run page asks "Was this run useful?". The phone asks too. Flow health uses the answers to show what a useful result costs.

## The report of a run

A run can end with a report: what it produced, in Markdown, such as research results or a market update. An [End node](Flows-and-nodes.md#end) writes it, or reads it from a file that a step of the run wrote.

- **The run page** shows the report in the End step. **Copy** puts it on your clipboard. **Download** saves it as a `.md` file. A run that ended with a report opens at it.
- **The Flows page** shows the start of each flow's latest report on its card. Click **Latest report** to read all of it.
- **Home** lists the latest report of each flow under the lanes, newest first. Point at a row to see the start of the report.
- Night Shift keeps the first 64 KB of a report. A longer report says so.
- A report from a file must be a text file in the folder the run works in. When the file is not there, or is not text, the run ends as the End node says, without a report. The run page tells you why.
- When the computer with the file is offline, the End node waits for it as long as the **Network** limit of the [run policy](#run-policy). Then the run ends the same way.
- When the steps run on two computers, the End node reads the file on the computer of the last step that worked in the project.
- In a project without a folder, each computer has its own folder of the run. The End node reads the folder on the computer of the run. A file that a step wrote on the other computer is not there.
- Images in a report show as links. Night Shift loads nothing from other websites.
- Night Shift never sends a report as a notification. Every Member of the Space can read it.

## The files of a run

A run of a [project without a folder](Get-started.md#a-project-without-a-folder) works in an empty folder of its own. **Files** on the run page lists what the run wrote there. Open a file in a new tab, or download it. Every Member of the Space can see them.

- The files stay on the computer that ran the steps. Open the run there to see them.
- When the steps run on two computers, each computer has a folder of its own. The run tells you so when it starts.
- The next run does not see them. To keep a value for the next run, use a variable with **Keep between runs**, or the project's [knowledge](Knowledge.md).
- With **Clean up old runs** on in **Settings**, Night Shift removes the files some days after the run ends. **Clean up after** sets the days, 90 by default. The run page shows the date.

## Stop and resume

- **Stop** a run now, or after the step that runs now.
- **Resume** a stopped, failed, or interrupted run at its last step. You can resume it from any computer of its Space. A viewer cannot resume a run.
- A run that a restart interrupted resumes by itself a few seconds after Night Shift starts again, unless its [run policy](#run-policy) says to wait for you.
- **Take over** copies the command that continues the agent's work in a terminal, on the computer that runs the run. On the phone, you share it.

## Schedules

A schedule starts a flow with its inputs at a time of day or on a cron line, for example `0 22 * * 1-5`. It stops the run at its stop time, for example 07:00.

A flow's schedules are on the **Flows** page. Click what starts the flow on its card, or open its ⋯ menu and choose **Schedules**. There you add, change, pause or remove them.

- **The Host runs every schedule.** In a Space without a Host, this computer runs them. A step still runs on the computer that its node names.
- **A missed time still starts** within the schedule's late window. The default window is 15 minutes, and it can be up to 7 days. The run gets the time it was due as `{{run.due_at}}`.
- **Past the late window,** Night Shift skips the time and tells the people of the Space that the schedule did not start.
- **One run at a time.** A schedule does not start while its last run still runs.
- **Pause tonight** and **Run now** are on the phone too.

A Host without a copy of the project refuses the start. The schedule shows why. A project without a folder needs no copy. When you leave a Host, Night Shift pauses every schedule that is on, because the Host still runs them.

## Webhooks

A schedule can start when a webhook arrives, in place of a time. Use it to start a flow from GitHub Actions, n8n, Zapier, or a script. A webhook can also wake a Wait with a signal, for example when a build is done or a reply arrives. That webhook shows with the flow that waits for the signal.

Each webhook schedule has its own address and a secret. Night Shift accepts a request only with a valid signature (`X-Hub-Signature-256`) or with the secret as a bearer token. See [Start a flow from another tool](https://github.com/xiduzo/nightshift/blob/main/docs/deploy/triggers.md).

## Run policy

The policy of a flow keeps a run without you safe. A value that the flow leaves out comes from **Settings → Run policy** of the computer.

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

Flow health shows, for each flow, where its work landed, its runs per day, their cost against the median, why runs failed, and its metrics. Click a flow to open its details.

**Where the work landed** comes first. One bar shows the work: what agents, subflows and models made, and your answers to an Ask. One bar shows the choices: the Decisions. Each part of a bar is a rung:

- a tier of a cascade, such as Sonnet or Opus, or the agent or decider of a node without one,
- **Rule**, when a rule made the choice,
- **You**, when the work or the choice came to you,
- **Its deadline**, when the deadline answered for you,
- **Nowhere**, when no tier held and nobody was asked.

The line next to a bar gives each share, such as "Sonnet 78% · Opus 19% · You 3%". Point at the bars to see how often each rung got the work and what one time on it cost. That cost includes the tries before it. The tooltip also says how often a decider was not sure enough. The **Ladders** tab of a flow shows each rung, and the five nodes that ran most.

**Metrics** are the numbers that the steps of a flow report about their work. An Agent, a Command or a Value reports one with `{"scores": {"found": 4}}` in its data. See [Scores](Flows-and-nodes.md#scores). On the **Metrics** tab of a flow, choose a metric. You see its total, its value per run, its latest value, and the runs that reported it. Three charts show it per day, next to what the runs spent and how often they needed you.

**Per useful result** shows what all runs of a flow cost, divided by the runs that people found useful. Runs that failed or that nobody answered count in the cost too. Under it, you see how many runs with an answer were useful.

**Needed you** shows the share of a flow's runs that a person stepped in on. A person answered a Gate or an Ask, resumed, stopped, or took over the run. Point at the share to see why. When the share falls, the flow needs you less.

Home and each project page show the same number for all runs. Open **Needed you** to see why runs needed you, the runs that did, and the Gates that they asked.
