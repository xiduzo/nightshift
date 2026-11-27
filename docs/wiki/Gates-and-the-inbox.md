# Gates and the inbox

A Gate is a question from a flow to you, such as "Send this email?" or "Which candidate gets a report?". The run waits until you answer, then continues on the option that you pick. All questions wait in your **Inbox**, on your computer and on your phone.

New to flows? Read [How Night Shift works](How-Night-Shift-works.md) first.

## Answer a Gate

1. Open **Inbox** in the sidebar. It shows one Gate at a time, the most urgent first.
2. Read the question and its brief. The option that the flow recommends comes first, with a badge.
3. Pick an option. Click it, or press its number key.
4. Optional: add a note or files. Some options need a note.
5. Click **Send**, or press Enter. Shift+Enter starts a new line.

Nothing goes out before you send. The next Gate then takes its place.

To move through the inbox:

- **Previous** and **Next**, or the arrow keys, move between Gates.
- **Skip for now** moves a Gate to the end of the queue.
- What you picked and wrote stays while you look at another Gate.

You can also answer from your phone. See [Phone app](Phone-app.md).

## Add a Gate to your flow

A Gate has two jobs:

- **Approval.** You say yes before an act that you cannot undo, such as a sent email, a published post, or a merge.
- **Fallback.** A rule or a model makes the choices that it can. A Gate gets the rest: the ladder ran out, or a model was not sure enough.

Give every other choice to a rule or a model. A Gate on every result puts you back in the loop. See [Deciders](Flows-and-nodes.md#deciders).

To add a Gate, for example before a flow sends an email:

1. In the flow editor, click an empty spot of the canvas and press **Tab**.
2. Type `approve`, and pick **Gate**.
3. In **Question**, write what you must decide, with the context. For example: `The agent wrote this reply: {{draft.output}}. Send it?`
4. Give the Gate its options, for example `send` and `skip`.
5. Connect the `send` outcome to the step that sends the email.
6. Connect the `skip` outcome to an End node, or leave it without an edge. An outcome without an edge ends the run.

[Your first flow](Your-first-flow.md#ask-before-you-send-it) shows a Gate in a full flow.

## What a Gate shows you

Each Gate has an urgency and a brief. They help you decide fast.

- **Urgency.** "Now", "Today", or "When you have time". A Gate without one is "Today".
- **Situation.** Why a person must decide.
- **Background.** What is already decided, checked, or done. An item can name where its fact comes from.
- **Recommendation.** The option that the flow recommends, and why.
- **Impact.** Under each option: what happens when you pick it.

The flow can write each part, under **Brief** in the editor. When **Night Shift writes what you leave empty** is on, Night Shift writes the empty parts when the Gate opens. The inbox says so. Turn the switch off to show only what the flow wrote.

A Gate can also have:

- **A title.** A short title of at most 80 characters is the heading in the inbox. The question below it holds the details and the lists.
- **A deadline.** When nobody answers in time, the Gate picks an option for you. Set it under **Deadline**, then choose the option in **Then pick**.
- **The lock screen.** A Gate with two options can allow an answer from the lock screen of your phone. Turn on **Can be answered from the lock screen**.

An answer can hold:

- **A note.** The next steps read it.
- **Files.** Up to 10 files, 10 MB together. The next Agent steps of the run get them.

## Asks

An Ask is a form in your inbox. Use it when a flow needs a value from you, not a choice. For example, a budget, a list of names, or a short text.

An Ask is a Value node that a person makes. Its fields come from a JSON schema.

- An Ask can have a title, as a Gate can.
- An earlier step can fill the choices of a field.
- An Ask can show files from the copy of the project of the run, and links. An image shows inline.
- An Ask with a deadline takes its default value when nobody answers in time. Without a default, the step fails.

The phone answers simple Asks too.

## Questions from an agent

An Agent step can ask you a question while it works. Its question opens a Gate. Your answer goes back to the same agent session, and the agent continues. Asks and questions from an agent have an urgency, a situation, and a background too.

## The inbox

The Gates and Asks that wait for you, in every project, form one queue:

1. Now, then Today, then When you have time.
2. In each level, the Gates with a deadline come first, the earliest first.
3. Then the other Gates, the oldest first.

A row of bars at the top shows the queue, one bar for each Gate, in the color of its level. The Gate in focus starts with how soon it needs you: its level, its deadline, and the option that Night Shift picks then.

- **Answered** shows the Gates that closed, by day, for 90 days. Each one shows the option it took, who chose it, and the status of the run now. Open one to see the note, every option it offered, and what it asked.
- **Sleeping** shows the runs that wait for a usage limit or the network. They continue by themselves.

Home does not list your Gates. Home shows the flows that need a look, and what your flows produced. See [Home](Runs-and-schedules.md#home).

### Who can answer

Every person in a Space gets its Gates and Asks in their inbox. An owner, an admin, or a member can answer. A viewer sees them, but cannot answer. See [Spaces](Computers-and-Hosts.md#spaces).

### Notifications

A Gate sends a notification only for the levels that you choose. Go to **Settings**, then **Notifications**, and set **Push for**. The default is Now. A Gate of another level waits in the inbox without a notification.

**Push for** Now also sends a notification when a flow fails again and again.

### Parallel branches

In a run with parallel branches, a Gate can open while a step on another branch still works. The inbox then shows that the run is busy. You can pick your answer now. Night Shift sends it when that step ends.

While a Gate waits for you, the other branches go on. A Wait on another branch wakes at its time, or when its signal comes. When you answer one of two Gates, its branch goes on, and the other Gate keeps waiting. One exception: a Wait beside a Subflow that waits at a Gate wakes after you answer that Gate.

## Advanced: answer from a terminal

An agent in a terminal reads the same inbox with the `needs_me` tool, and answers a Gate with `answer_gate`. See [Terminal and MCP](Terminal-and-MCP.md).
