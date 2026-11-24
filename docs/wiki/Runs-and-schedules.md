# Runs and schedules

A run is one time that a flow runs, from start to end. This page tells you how to start a run, follow it, and stop it. It also tells you how to run a flow at set times with a schedule, and how to see how your flows do.

New to flows? Read [How Night Shift works](How-Night-Shift-works.md) first.

## Start a run

1. Open the flow in the editor.
2. Choose **Run**.
3. Fill in the inputs of the flow, for example a topic such as "electric cargo bikes".
4. In a project with a folder, choose the branch to start from. The default is fine for most runs.
5. Choose **Start**. The run page opens.

There are more ways to start a run:

- **Quick run** on a project starts one agent from a prompt, with no flow. Choose a profile or a model. Quick run can also start a flow, with the most used flows first.
- A [schedule](#schedules) starts a flow at set times.
- A [webhook](#webhooks) starts a flow when another tool calls it.

## Follow a run

The run page shows each step live:

- what the agent does and says,
- the files that the step changed,
- what the step cost, and how many tokens it used.

A run ends in one of three ways: **Done**, **Nothing to do**, or **Failed**.

When a run fails or stops early, choose **Ask why**. An agent reads the run, and tells you what went wrong and what you can do. It changes nothing.

When a run finishes, the run page asks whether the run was useful. Your phone asks too. The opened row of a flow in [Flow health](#flow-health) counts the useful runs.

### Your files stay as they are

Each run works in its own copy of your project. Runs do not change the files in your folder. A run of a project with a folder works on a branch named `nightshift/…`.

A run of a project without a folder starts in an empty folder of its own. See [The files of a run](#the-files-of-a-run).

## Stop and resume

- **Stop now** stops the run at once. **Stop after this step** lets the current step finish first.
- **Resume** continues a stopped, failed, or interrupted run at its last step. You can resume it from any computer of its Space.
- **Run again from here** on a step runs the flow again from that step.
- **Take over** copies the command that continues the agent's work in a terminal, on the computer of the run. On the phone, you share the command.

A viewer of a Space cannot resume a run.

When Night Shift restarts, an interrupted run resumes by itself after a few seconds. The [run policy](#run-policy) can tell it to wait for you instead.

## The report of a run

A run can end with a report: what it produced, in Markdown. For example, research results or a market update. An [End node](Flows-and-nodes.md#end) writes the report, or reads it from a file that a step of the run wrote. [Your first flow](Your-first-flow.md) shows how.

You find the report in three places:

- **The run page** shows it in the End step. A run that ended with a report opens at it. **Copy** puts it on your clipboard. **Download** saves it as a `.md` file.
- **The Flows page** shows the start of the latest report on the card of each flow. Choose **Latest report** to read all of it.
- **Home** lists the latest report of each flow under **What came out**, the newest first.

Every Member of the Space can read a report. Night Shift never sends a report as a notification.

Limits:

- Night Shift keeps the first 64 KB of a report. A longer report says so.
- Images in a report show as links. Night Shift loads nothing from other websites.
- The report of a [test run](#test-runs) shows only on its run page.

A report from a file must be a text file in the folder of the run. When the file is not there, or is not text, the run ends without a report. The run page tells you why. See [Reports from a file](#reports-from-a-file).

## Schedules

A schedule starts a flow for you at set times. For example, a news brief each morning at 07:00, or a log check each weeknight.

To add a schedule:

1. Open the **Flows** page of the project.
2. On the card of the flow, open the ⋯ menu and choose **Schedules**.
3. Choose **Add schedule**.
4. Choose **At set times**.
5. Choose the time and the days, for example **Every day** at `07:00`.
6. Fill in the inputs of the flow.
7. Optional: turn on **Stop by a set time**, and set a **Stop time**. A run that is not done by then stops.
8. Choose **Add schedule**.

For more control, choose **Cron** in step 5 and type a cron line. For example, `0 22 * * 1-5` runs at 22:00 on weekdays.

On the same page, you change, pause, or remove a schedule. You can also choose what starts the flow on its card to open its schedules.

How a schedule behaves:

- **One run at a time.** A schedule does not start while its last run still runs.
- **A missed time still starts** when Night Shift comes back within **Start late up to**. The default is 15 minutes. You can set up to 7 days. The run gets the time it was due as `{{run.due_at}}`.
- **After that time,** Night Shift skips the run. It tells the people of the Space that the schedule did not start.
- **Pause tonight** and **Run now** are on the phone too. See [Phone app](Phone-app.md).

A schedule needs a computer that is on. When your laptop sleeps, its schedules do not start. To run schedules all the time, use a Host on a server. In a Space with a Host, the Host runs every schedule. A step still runs on the computer that its node names. See [Computers and Hosts](Computers-and-Hosts.md).

## Webhooks

A webhook starts a flow when another tool calls an address. For example, GitHub Actions, n8n, Zapier, or your own script.

1. Save a long random secret on the Secrets page, for example as `NIGHTSHIFT_HOOK_SECRET`.
2. Add a schedule, as in [Schedules](#schedules).
3. Choose **When a webhook arrives** in place of **At set times**.
4. In **Secret**, type the name of the secret: `NIGHTSHIFT_HOOK_SECRET`.
5. Give the inputs of the flow values from the call, for example `{{event.body.topic}}`.
6. Choose **Add schedule**. Copy the **Address** into the other tool.

Night Shift accepts a call only with a valid signature (`X-Hub-Signature-256`), or with the secret as a bearer token. For example:

```bash
curl -X POST "<address>" \
  -H "Authorization: Bearer <secret>" \
  -H "Content-Type: application/json" \
  -d '{"topic": "electric cargo bikes"}'
```

A webhook can also wake a Wait node with a signal, for example when a build is done or a reply arrives. That webhook shows with the flow whose Wait listens for the signal.

[Start a flow from another tool](https://github.com/xiduzo/nightshift/blob/main/docs/deploy/triggers.md) tells how to sign a call, filter calls, and reach a Host from outside.

## Test runs

A test run tries one part of a flow. You start it in the flow editor, with pinned or skipped nodes. A pinned node gives its output of an earlier run again. A skipped node gives the outcome that you choose. [Test a flow](Flows-and-nodes.md#test-a-flow) tells the steps.

- A pinned or skipped step does not run. It takes no time and costs nothing. The other steps run for real.
- A test run keeps nothing for the next run. It writes no kept variables, and a Since last run node does not remember what it saw.
- Each list of runs shows a test run with a **Test run** badge. The run page does not ask whether it was useful.
- A test run counts only in what a project spent. Home, the project page, [Flow health](#flow-health), and the icon of the project in the sidebar leave it out.

## See how your flows do

### Home

Home is a short note about all your projects. Read it from top to bottom.

- **The heading** says how many flows need a look. When you come back, it says how many are new since your last look.
- **The line under it** says how often your flows needed you without a plan, this week and last week. See [Needed you, with and without a plan](#needed-you-with-and-without-a-plan).
- **Needs a look** lists each flow that does not do what it usually does. For example, its last runs failed, or found nothing to do, or cost more or took longer than usual. Night Shift learns what is usual from the runs of the flow. You set no limits.
- **What came out** lists the latest report of each flow from the last 7 days.

To look at a flow under **Needs a look**:

1. Choose **Look**. A panel shows what is unusual, and what is usual for this flow.
2. If a run failed, choose **Ask why**. An agent reads the run and tells you what went wrong.
3. Choose **Open the run** or **Open the flow** to fix the cause.
4. Choose **Looked at it**. The flow folds to one line. It comes back when the problem starts again.

A flow stays under **Needs a look** until it does its usual work again. When its last 2 runs failed, your phone and your other screens get one notification. That notification follows **Push for** Now and your quiet hours. Home keeps your last look in this browser. Another browser starts fresh.

### Needed you, with and without a plan

Night Shift counts each time that you stepped in on a run.

- **As planned:** you answered a Gate or an Ask that the flow has for you, such as an approval.
- **Without a plan:** a choice came to you because a rule or a decider did not hold. Or you continued, stopped, or took over a run.

The aim is no time without a plan. A planned approval is fine.

### Levels

Each flow has a level. Night Shift measures it from the last 10 runs of the flow that ended.

| Level | What it means |
| --- | --- |
| **You decide** | You stepped in on more than half of the runs. |
| **You check** | You stepped in on some of the runs. |
| **On its own** | You stepped in on none of the runs. |

A flow with fewer than 3 runs that ended has no level yet.

### Flow health

The page of a project shows one row for each flow. A row shows the level, the last runs, the times it needed you without a plan, and how steady the runs are. The number at the top compares with the same days before. Choose 7, 30, or 90 days.

**Predictability** shows two strips: the time of a run, and the cost of a run. Each strip compares the finished runs with a usual run of that flow. A short strip means that you can predict the next run. The color says how steady the runs are:

| Color | What it means |
| --- | --- |
| Green | Most runs stay within 20% of a usual run. |
| Amber | Some runs take or cost a lot more or less than a usual run. |
| Red | Many runs take or cost over twice a usual run, or one took or cost over four times that. |
| Gray | The flow has fewer than 3 finished runs. |

An icon after the name of a flow means that the flow needs a look. Point at the icon to see why.

A row with an arrow opens. It shows what your changes to the flow did, and what to change next:

- **The timeline** shows the runs over twice the days that you chose. A green dot finished, a red dot did not. A ring means that the run needed you without a plan. A mark shows each change of the flow. Point at a mark to see what changed. Select a dot to open its run.
- **Before and after** compares the runs since your last change with the 10 runs before it. It also compares the days that you chose with as many days before. An arrow shows a number that moved by 10% or more: green when it got better, red when it got worse.
- **The next change to try** lists what the runs show, the most important first. Each line says what to do and why. **Improve with an agent** opens the flow with a chat. The agent reads the run and proposes a change. You decide whether to apply it.

Saves less than 30 minutes apart count as one change. A save that only moves nodes on the canvas is no change. After you change a flow, the table shows the effect when the next runs end. Make one change at a time. Then you can see what each change did.

A row without an arrow has no runs yet.

### Spend

**Spend** in the sidebar shows what your flows cost. Choose 7, 30, or 90 days.

The cards at the top compare what the runs spent with the same days before. They also show how many flows have a steady cost, and what a change could save.

**How predictable each flow is** has one row for each flow that cost money. The strip compares the cost of its runs with a usual run of that flow. A short strip means a steady cost. The legend under the list names each color.

| Color | What it means |
| --- | --- |
| Green: **Steady** | Most runs cost within 20% of a usual run. |
| Amber: **Varies** | Some runs cost a lot more or less than a usual run. |
| Red: **Hard to predict** | Many runs cost over twice a usual run, or one cost over four times that. |

Click a row to see what each step costs per run, and the ways to save on that flow.

**Ways to save** lists the changes that your runs show, the biggest first:

- **Fix the runs that do not finish.** A run that failed or stopped still cost money.
- **Check for work before the agents start.** Some runs found nothing to do, and still cost money.
- **Keep the costly runs near a usual run.** Some runs cost over twice a usual run. The card names the step with the most extra cost.

**Open the run** shows the newest run behind a card. **Open the flow** opens the flow, where you make the change. **Improve this flow** opens the flow with a chat. The agent reads that run and proposes a change. You apply it or discard it.

## Advanced

### Run policy

The run policy keeps a run without you safe. Each flow can set its own limits. A limit that the flow leaves out comes from **Settings → Run policy** of the computer.

| Limit | What it does |
| --- | --- |
| Budget | The run stops as failed when its known cost passes an amount in USD. A resume may spend as much again. |
| Turns | An Agent step fails when one session takes more model replies than this. |
| Idle | An Agent step fails when it does nothing for this long. |
| Steps | The run stops after this many steps, so a loop cannot run forever. You can resume it. |
| Usage limit | The step waits, then continues the same session. Without a known reset time, it waits 5 minutes first, then twice as long each time, up to 60 minutes. |
| Network | The longest time that a step waits for the network before it fails. The default is 240 minutes. |
| Resume after a restart | A run that a restart stopped continues by itself, or waits for you. |

### The files of a run

A run of a [project without a folder](Get-started.md#a-project-without-a-folder) works in an empty folder of its own. **Files** on the run page lists what the run wrote there. Open a file in a new tab, or download it. Every Member of the Space can see the files.

- The files stay on the computer that ran the steps. Open the run there to see them.
- When the steps run on two computers, each computer has a folder of its own. The run tells you so when it starts.
- The next run does not see them. To keep a value for the next run, use a variable with **Keep between runs**, or the project's [knowledge](Knowledge.md).
- With **Clean up old runs** on, Night Shift removes the files some days after the run ends. **Clean up after** sets the days, 90 by default. The run page shows the date. See [Cleanup](#cleanup).

### Reports from a file

An End node can read the report from a file that a step wrote, such as `report.md`.

- When the computer with the file is offline, the End node waits for it as long as the **Network** limit of the [run policy](#run-policy). Then the run ends without a report.
- When the steps run on two computers, the End node reads the file on one of them. That is the computer of the last step that worked in the project.
- In a project without a folder, the End node reads the folder on the computer of the run. A file that a step wrote on another computer is not there.

### Cleanup

Night Shift removes old runs for you. **Clean up old runs** in **Settings** turns this on or off. It is on by default.

- A day after a run ends, Night Shift removes the copy of your project for that run, and its branches on this computer.
- Work that is saved nowhere else stays hidden first. That is changes that are not committed, and commits that are not on the remote or in your main branch. Your list of branches does not show it. **Clean up after** sets how long it stays, 90 days by default. Then it goes too.
- Work that you merged counts as saved, also with a squash merge or a rebase merge.
- Branches on the remote stay. Night Shift does not delete or push them.
- A run that runs, waits at a Gate, or sleeps keeps all of it.

To get the work of a run back, resume it or run it again from a step. When the copy is gone, **Resume** and **Run again from here** make it again first. The run page tells you where the work comes from. That is the branch of the run, the work that Night Shift kept, or the branch on the remote. Without any of them, the copy starts where the run started.

### Branches and the remote

A run on a branch starts from the newest commit of that branch on the remote. When the local branch has commits that the remote does not have, the local branch wins.

### When a computer goes offline

A computer that goes offline does not end the run:

- A step with a [backup](Agents-and-profiles.md#backups) moves to the first backup that can take it.
- A step without a profile moves to the next computer of the run that can take it.
- Otherwise the step waits for its computer until the stop time, and Night Shift tells you.

### From a terminal

An agent in a terminal can start a run with the `start_run` tool. The `list_runs` and `get_run` tools tell it which run is a test run. See [Terminal and MCP](Terminal-and-MCP.md).
