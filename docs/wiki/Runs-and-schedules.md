# Runs and schedules

## Start a run

- **Run** in the flow editor starts the flow. The start dialog asks for its inputs. In a project with a folder, it also asks for the branch to start from.
- **Quick run** on a project starts one Agent from a prompt, with no flow. Choose a profile or a model, as in the chat. It can also pick a flow, with the most used flows first.
- A [schedule](#schedules) or a [webhook](#webhooks) starts a run without you.
- An agent in a terminal starts a run with the `start_run` tool. See [Terminal and MCP](Terminal-and-MCP.md).

Each run works in its own copy of your project, on a branch named `nightshift/…`. Runs do not change the files in your folder. A run on a branch starts from its newest commit on the remote. When the local branch has commits that the remote does not have, the local branch wins.

A run of a project without a folder starts in an empty folder of its own, with no branch. See [The files of a run](#the-files-of-a-run).

You follow each step live: its transcript, the files that it changed, its cost, and its tokens.

When a run finishes, the run page asks "Was this run useful?". The phone asks too. Flow health shows how many runs were useful when you open the row of a flow. A [test run](#test-runs) does not ask.

## Test runs

A test run is a run that you start from the flow editor with pinned or skipped nodes. See [Flows and nodes](Flows-and-nodes.md). It shows a **Test run** badge on the run page and in the lists of runs.

- A pinned node does not run. Its step gives the output of the node in an earlier run. The step links to that run.
- A skipped node does not run. Its step takes the outcome that you chose, and its outputs are empty.
- These steps have no transcript, take no time and cost nothing. The other steps run for real.
- A test run keeps nothing for the next run. It writes no kept variables, and Since last run does not remember what it saw.

A test run counts only in what a project spent. Home, the numbers of the project page and [Flow health](#flow-health) leave it out. The icon of a project in the sidebar leaves it out too. A try does not change how your flows look.

The run page and every list of runs show a test run with its **Test run** badge. The `list_runs` and `get_run` tools tell an agent which run is a test run. See [Terminal and MCP](Terminal-and-MCP.md).

## The report of a run

A run can end with a report: what it produced, in Markdown, such as research results or a market update. An [End node](Flows-and-nodes.md#end) writes it, or reads it from a file that a step of the run wrote.

- **The run page** shows the report in the End step. **Copy** puts it on your clipboard. **Download** saves it as a `.md` file. A run that ended with a report opens at it.
- **The Flows page** shows the start of each flow's latest report on its card. Click **Latest report** to read all of it.
- **Home** lists the latest report of each flow under **What came out**, the new ones first.
- The report of a [test run](#test-runs) shows only on its run page.
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
- With **Clean up old runs** on in **Settings**, Night Shift removes the files some days after the run ends. **Clean up after** sets the days, 90 by default. The run page shows the date. See [Cleanup](#cleanup).

## Stop and resume

- **Stop** a run now, or after the step that runs now.
- **Resume** a stopped, failed, or interrupted run at its last step. You can resume it from any computer of its Space. A viewer cannot resume a run.
- A run that a restart interrupted resumes by itself a few seconds after Night Shift starts again, unless its [run policy](#run-policy) says to wait for you.
- **Take over** copies the command that continues the agent's work in a terminal, on the computer that runs the run. On the phone, you share it.
- When the [cleanup](#cleanup) removed the run's copy of your project, **Resume** and **Run again from here** make it again first. The run page tells you where from: the run's branch, the work Night Shift kept, or the branch on the remote. Without any of them, the copy starts where the run started.

## Cleanup

Night Shift cleans up after your runs. **Clean up old runs** in **Settings** turns it on or off. It is on by default.

- A day after a run ends, Night Shift removes the run's copy of your project and its branches on this computer.
- Work that is saved nowhere else stays hidden first: changes that are not committed, and commits that are not on the remote or in your main branch. Your list of branches does not show it. **Clean up after** sets how long it stays, 90 days by default. Then it goes too.
- Work that you merged counts as saved, also with a squash merge or a rebase merge.
- Branches on the remote stay. Night Shift does not delete or push them.
- A run that runs, waits at a Gate or sleeps keeps all of it.
- To get the work of a run back, resume it or run it again from a step.

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

## Home

Home is a short note about all your projects. Read it from top to bottom.

- **The heading** says how many flows need a look. When you come back, it says how many are new since you last looked.
- **The line under it** says how often your flows needed you without a plan this week, and last week.
- **Needs a look** lists each flow that does not do what it usually does: its last runs failed, its last runs found nothing to do, or its last run cost more or took longer than usual. Night Shift learns what is usual from the runs of the flow. You set no limits.
- **What came out** lists the latest report of each flow from the last 7 days.

A flow stays under **Needs a look** until it does its usual work again. To look at one:

1. Choose **Look**. A panel shows what is unusual, and what is usual for this flow.
2. If a run failed, choose **Ask why**. An agent reads the run and tells you what went wrong. It changes nothing.
3. Choose **Open the run** or **Open the flow** to fix the cause.
4. Choose **Looked at it**. The flow folds to one line. It comes back when the problem starts again.

Home keeps your last look in this browser. Another browser starts fresh.

## Needed you, with and without a plan

Night Shift counts each time that you stepped in on a run.

- **As planned:** you answered a Gate or an Ask that the flow has for you, such as an approval.
- **Without a plan:** a choice came to you because a rule or a decider did not hold. Or you continued, stopped, or took over a run.

The aim is no time without a plan. A planned approval is fine.

## Levels

Each flow has a level. Night Shift measures it from the last 10 runs of the flow that ended.

| Level | What it means |
| --- | --- |
| **You decide** | You stepped in on more than half of the runs. |
| **You check** | You stepped in on some of the runs. |
| **On its own** | You stepped in on none of the runs. |

A flow with fewer than 3 runs that ended has no level yet.

## Flow health

A project's page shows one row for each flow: its level, its last runs, how often it needed you without a plan, and how steady the time and the cost of a run are. The number on top of the page compares with the same days before. Choose 7, 30 or 90 days. Flow health leaves [test runs](#test-runs) out.

**Predictability** shows two strips: the time of a run over the cost of a run. Each strip shows the finished runs of the flow against a usual run of that flow. A short strip means that you can predict the next run. The colour says how steady the runs are:

| Colour | What it means |
| --- | --- |
| Green | Most runs stay within 20% of a usual run. |
| Amber | Some runs take or cost a lot more or less than a usual run. |
| Red | Many runs take or cost over twice a usual run, or one took or cost over four times that. |
| Grey | The flow has fewer than 3 finished runs. |

An icon after the name of a flow means that the flow needs a look. Point at the icon to see why.

A row with an arrow opens. An opened row shows what your changes to the flow did, and what to change next.

- **The timeline** shows the runs of the flow over twice the days you chose. A green dot finished, a red dot did not. A ring means that the run needed you without a plan. A mark shows each change of the flow. Point at it to see what changed. Select a dot to open its run.
- **Before and after** compares the runs since your last change with the 10 runs before it. It also compares the days you chose with as many days before. An arrow shows a number that moved by 10% or more: green when it got better, red when it got worse.
- **The next change to try** lists what the runs show, the most pressing first. Each line says what to do and why. **Improve with an agent** opens the flow with a chat. The agent reads the run and proposes a change. You decide whether to apply it.

Saves less than 30 minutes apart count as one change. A save that only moves steps on the canvas is no change. After you change a flow, the table shows the effect when the next runs end.

Make one change at a time. Then you can see what each change did.

A row without an arrow has no runs yet. The [Spend](#spend) page is in the sidebar.

## Spend

**Spend** in the sidebar shows what your flows cost. Choose 7, 30 or 90 days.

The cards on top show what the runs spent against the same days before, how many flows have a steady cost, and what a change could save.

**How predictable each flow is** has one row for each flow that cost money. The strip shows what its runs cost against a usual run of that flow. A short strip means a steady cost. The colour of the strip says how steady the cost is. The legend under the list names each colour.

| Colour | What it means |
| --- | --- |
| Green: **Steady** | Most runs cost within 20% of a usual run. |
| Amber: **Varies** | Some runs cost a lot more or less than a usual run. |
| Red: **Hard to predict** | Many runs cost over twice a usual run, or one cost over four times that. |

Click a row to open it. You see what each step costs per run, and the ways to save on that flow.

**Ways to save** lists the changes that your runs show, the biggest first:

- **Fix the runs that do not finish.** A run that failed or stopped still cost money.
- **Check for work before the agents start.** Some runs found nothing to do, and still cost money.
- **Keep the costly runs near a usual run.** Some runs cost over twice a usual run. The card names the step with the most extra cost.

**Open the run** shows the newest run behind a card. **Open the flow** opens the flow, where you make the change. **Improve this flow** opens the flow with a chat. The agent reads that run and proposes a change. You apply it or discard it.
