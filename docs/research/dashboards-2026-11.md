# Dashboards that get you out of the loop

**Status (2026-11-13):** Decided. The first part is built: planned and unplanned attention, the level of a flow, Needs a look from a flow's usual range, Home as a note, a project's page with one row per flow, and the Spend page (spend, how steady the cost of each flow is, and the ways to save that the runs show). Since 2026-11-13 an opened flow row shows the before and after of the last change (Q17), the range against the days before, and the next changes to try that the steps of the runs show (Q15, without tests). Not built yet: a missed schedule as a signal, spot checks, the judge, the shadow decider, trials, tested suggestions, the undo of a change, the range of 1 year, and on the Spend page a budget, a forecast, spend by agent and rung, and what improving saved.

On 2026-11-12 the owner and Claude Code decided what Home and a project's page
are for. Claude Code asked 37 questions in six rounds, and the owner answered each
one. This record keeps the questions, the answers and what the research found.

The dashboards counted runs, spend and failure rates. They did not help a person
move a flow from in the loop, to near the loop, to out of the loop. They also did
not watch the flows that already run without a person.

## The vision

The dashboards show the people who engineer the loops where each flow still needs
them, and why. They also show whether the flows that they stopped watching still
deserve that trust. The aim is flows that improve from their own runs.

## 1. What the research found

Two research agents read the code and the docs on main (3ccc7b87) during the
questions.

- **Home** shows these, from top to bottom:
  - a heading line
  - four numbers: Runs, Finished, Spend and Needed you
  - three lanes: Running now, Waiting for you and Failed
  - Latest reports
  - Projects
- **A project's page** shows the same four numbers on a chart, and four tabs: Flows,
  Failures, Gates and Spend. Flows is Flow health. It has "Where the work landed",
  "Per useful result" and "Needed you".
- **No level of trust or autonomy exists**, per flow or per Gate. Nothing suggests
  that a person remove a Gate or let a decider choose.
- **"Near the loop" exists only as a Gate with a deadline** that chooses an option.
  The dashboard counts a deadline's choice as "not answered", and Needed you does
  not count it.
- **Needed you does not tell an approval from a fallback.** No Gate is marked as one
  or the other. Its shape tells it: a person tier at the end of a cascade is a
  fallback. A Gate decided by a person alone is an approval.
- **The data for a shadow comparison exists.** `GateOpened` keeps a Gate's
  recommendation and an Ask's prefill. `Scored` and `StepEnded` keep the answer.
  No code compares them. No event names the person who answered a Gate.
- **"Done" and "nothing to do" both count as finished.** Only the hover card of
  Latest reports shows the difference.
- **A missed schedule is only a push.** The schedule card shows it. Neither
  dashboard reads schedule data. Nothing finds drift.
- **A test run keeps no kept values, memory or shapes** (ADR 27). A step's
  Knowledge changes still sync back to the Space. A Command or an Agent that pushes,
  sends or posts does it for real. Nothing marks a step as one that acts outward.
- **Night Shift keeps run history.** Only the removal of a Space deletes events.
  These stop at 90 days:
  - the Cleanup of run files (`cleanUpAfterDays`)
  - the answered Gates of the Inbox (`INBOX_KEEP_MS`)
  - notification deliveries
  - the longest range of the dashboards
- **"Insights" is already a name.** It names the admin app of the anonymous usage
  data.

## 2. Decisions

### 2.1 The job and the reader

| Q | Question | Recommended | Owner |
| --- | --- | --- | --- |
| 1 | What the dashboards are for | A: graduate and guard. They help a person hand work to Night Shift step by step. They show that the flows nobody watches still earn that trust. Runs, spend and failure rates become evidence, not the headline. | A |
| 6 | Who reads them | The person who engineers the loops. They build the flows, own them, and decide how much to leave to Night Shift. Members who only answer Gates work in the Inbox and on the phone. | "indeed for the engineers (and perhaps we need a different $$$$$ insights page?" See Q9. |
| 7 | How Home and a project's page share the work | Home guards every project over a short span. A project's page graduates each flow over weeks. Home links to "N flows could need you less". | "yes indeed!" |
| 8 | Which ladder | Both. Fewer of you on the choice ladder, and cheaper rungs on the work ladder. Cost per useful result is the guard rail. | "both are indeed equally important" |

### 2.2 Levels and attention

| Q | Question | Recommended | Owner |
| --- | --- | --- | --- |
| 2 | What the levels mean | Night Shift measures them per flow from its recent runs, not from how it is drawn. **In the loop:** you are in the normal path of most runs. **Near the loop:** Night Shift does the work and makes the choices. You come in when a ladder runs out, and you look at what came out. **Out of the loop:** nobody is in the normal path, and nobody reads every result. A person can open the Gates and steps that keep a flow at its level. | "yes" |
| 19 | What the levels are called | **You decide** (in), **You check** (near), **On its own** (out). | "yes!" |
| 3 | Whether every flow must leave the loop | No. The target is zero unplanned attention. A planned approval is no debt. Needed you splits into planned and unplanned. | "yes, planned vs unplanned!" |
| 12 | What counts as planned | **Planned:** an approval Gate that the Builder drew before an act that cannot be undone, and a spot check. **Unplanned:** a fallback Gate (a ladder ran out), and each resume, stop, take-over, re-run or fix after it. How the Builder drew the Gate decides which it is. No flow has a target level. | "yup" |
| 13 | How a choice graduates | 1. You decide: an approval Gate. 2. It goes on unless you object: a deadline chooses the recommendation, and you can still answer. 3. A decider chooses, and you get only the choices it is not sure of. 4. A rule or a decider chooses alone. Steps 2 and 3 are You check. Step 4 is On its own. A deadline's choice counts as Night Shift alone. An answer before the deadline counts as planned attention. | "yup" |
| 27 | The unit of the north-star number | B: a count of unplanned interruptions. The share of runs is a second figure in the details. A share stays the same when the runs double, but you get twice as many interruptions. | "B mostly indeed" |
| 34 | Where the level shows | On a project's page, on the flow card and in the editor. | "makes sense to me" |

### 2.3 Flows that nobody watches

| Q | Question | Recommended | Owner |
| --- | --- | --- | --- |
| 4 | What a healthy flow is | Five signals. 1. It ran when it should. 2. It finished. 3. It produced its outcome. 4. It stayed in its usual range. 5. No person had to fix its work after the run. Signals 1, 3 and 4 rank above 2, because a failure already reaches the Inbox. | "makes sense" |
| 5 | How results stay good when nobody reads them | A and B. A: spot checks. Night Shift asks you to rate one run in N, and N grows as the flow earns trust. B: an automatic judge, as an option per flow. Out of the loop means attention by sample, not zero attention. | "indeed a + b" |
| 30 | What a good result is | A flow gets an "A good result…" description. The Builder writes it, or the improver drafts it from the ratings of spot checks. The judge scores against it. When a person and the judge disagree, the judge counts for less, and Night Shift says so. | "yes" |
| 31 | The usual range | Night Shift learns it per flow from recent runs: time, cost, amount of output, the rung that did the work, and quality. Nobody sets a threshold. A person can mute one signal of a flow. | "yeah, this would also mean that we probably should increase the time we keep runs around from 90 days to, lets say, a year?" See Q35. |
| 32 | Where spot checks reach you | In the Inbox, as "When you have time". They never push. They count as planned attention. | "yup" |
| 11 | When a flow that nobody watches goes wrong | B: Night Shift watches it more closely on its own. Spot checks increase, the flow shows in Needs a look, and a severe signal pushes as Now. Night Shift suggests a move back toward the loop. It changes or pauses the flow only by a rule that the person set. | "yup" |

### 2.4 Flows that improve from their own runs

| Q | Question | Recommended | Owner |
| --- | --- | --- | --- |
| 10 | Suggest or apply | A project's page suggests the next move with its evidence, and the person confirms it. Night Shift never applies a move on its own. Example: "This Gate's recommendation was taken 20 of 20 times. Let the decider choose?" | "this is indeed the direction i want to go towards, self improving flows based on data!" |
| 15 | What Night Shift may suggest | A: ladder moves (who decides, which rung starts, a deadline). B: rules that it learns from Gate answers. C: better words in prompts and instructions. D: structure (a check step, a split, a Gate). | All four: "i'd even say all while indeed D is the most invasive but most interesting" |
| 16 | Both ways | Yes. When the evidence turns, Night Shift suggests a stronger rung or a Gate again, with the same evidence. Q11 is about a sudden problem. This is about a slow decline. | "ofcourse" |
| 14 | Where the evidence comes from | **Choices:** a shadow decider makes a silent pick next to each Gate that a person answers. Night Shift compares the two. **Work:** a trial that the person confirms. The cheaper rung does a share of the runs, or test runs on recent inputs. Spot checks or the judge compare the results. | "makes sense" |
| 21 | What a person sets | "Improve flows" in the settings of a Space: the shadow decider, the improver agent, and a spend cap for trials, shadow picks and the improver. It applies to every flow. A flow can opt out. | "yup". At Q15 the owner asked for it: "a user has to configure those two entities in their settings". |
| 22 | Suggestions arrive tested | A suggestion that is not a ladder move comes with test runs on recent inputs. The person judges evidence, not an idea. The tests count against the spend cap. | "that makes sense, the hard part is that some flows make PRs or add knowledge, how are we going to deal with that (in a sandbox?)" See Q28. |
| 28 | Where a test stops | Night Shift's own state (files, kept values, memory, Knowledge) gets a temporary copy for the test. Knowledge is the new part. The outside world cannot be a sandbox: a pull request, a push, a message, an email, a post, a payment, an HTTP write. So the test stops before the first step that acts outward. It compares what would have gone out. An approval Gate marks that edge. A kit marks itself. The Builder marks a Command, an Agent or a Web request that acts outward. A step that is not marked counts as outward. | "yup" |
| 29 | How a confirmed change starts | On every run at once. Spot checks increase for the next runs, and the before and after starts. Night Shift offers an undo when the flow gets worse. | "yes" |
| 17 | Every change is measured | Each confirmed suggestion and each edit of a flow gets a before and after: unplanned attention, cost per useful result and the health signals. Night Shift offers to undo a change that made the flow worse. | "yup" |

### 2.5 The pages

| Q | Question | Recommended | Owner |
| --- | --- | --- | --- |
| 18, 23 | What Home shows | Every project, since you last looked, with no range. 1. **Needs a look:** one row per flow, in place of Failed. 2. **What came out:** Latest reports. 3. **The north-star number,** compared with the time before. 4. **"N flows could need you less".** Waiting for you goes, because the Inbox does that work. Running now goes, because a run that takes longer than usual is a Needs a look row. Runs, Finished, Spend and the Projects card go. | Q18: "not so sure for the 'waiting for you' as this is the inboxs' job right?" Q23: "yeah" |
| 25 | What a project's page shows | Per flow: 1. The level, and since when. 2. Unplanned attention with its causes. 3. Both ladders, with the cost per landing. 4. The useful rate and the cost per useful result. 5. Suggestions with their evidence. 6. Each change with its before and after. On top, the trend of the project over 7, 30 or 90 days or 1 year, always compared. The Spend and Gates tabs go. Failures move into the health of each flow. | "makes sense" |
| 9, 26, 33 | Money | A page of its own, **Spend**, per Space, for the person who pays, read once a month. It shows four things. 1. Spend with a budget and a forecast. 2. Spend by project, flow, agent and rung. 3. Cost per useful result, and the count of useful results. 4. What improving saved, next to what it cost. The dashboards keep cost only as evidence. "Insights" stays the name of the usage app. | Q9: "makes sense to me". Q26: "lets start with this!" Q33: "yes" |
| 20, 24 | The phone | A simple controller for a person who is out. It keeps push alerts for Now: Gates marked Now and severe Needs a look signals. It keeps answers to Gates, Pause tonight, Run now and Stop. It opens what a push links to. It shows no numbers, no list of reports and no north-star number. | Q20: "the phone should be a simple 'on the go' controller where users mostly get allerted for things that need to happen 'now' - no need for any fancy insights to be honest, that is the job of the desktop and web app". Q24: "yup" |

### 2.6 Data, success and docs

| Q | Question | Recommended | Owner |
| --- | --- | --- | --- |
| 35 | Keep runs for a year | Night Shift keeps run history already. The Cleanup of run files stays at 90 days. A project's page gets a range of 1 year. The usual range uses recent runs, so an old normal does not hide a new problem. | "okay, nice!" |
| 36 | How we know that it works | Four measures in Insights. 1. The unplanned interruptions of a flow fall in its first weeks. 2. The share of flows that run On its own grows. 3. People confirm suggestions and seldom undo them. 4. Cost per useful result stays the same or falls. | "yup" |
| 37 | Where it is written | Now: this record, and the direction in VISION, PLAN and TECH. When each piece ships: the glossary, the DESIGN rules of Home and of a project's page, and the wiki. | "yes, and perhaps we should also update our VISION.md and TECH.md where it makes sense?" |

## 3. New words

These go into `docs/glossary.md` when each piece ships:

- **You decide, You check, On its own:** the level of a flow.
- **Planned attention** and **unplanned attention.** An **unplanned interruption**
  is one time that a flow needed you without a plan.
- **Needs a look:** a flow that nobody watches and that shows a problem.
- **Spot check:** one run that Night Shift asks you to rate.
- **Shadow decider** and **shadow pick.**
- **Improver**, **judge** and **"A good result…"**.
- **Trial:** a cheaper rung on a share of the runs, after a person confirms it.
- **The edge:** the first step of a test that acts outward.
- **Spend** and **Payer.**

## 4. Not decided yet

- How to build each piece, and in which order.
- How many recent runs set a level and a usual range.
- How a Builder marks a step that acts outward, and how a kit marks itself.
- Where Spend sits in the sidebar.
- Whether the answer of a Gate names the person who answered. It does not today.
