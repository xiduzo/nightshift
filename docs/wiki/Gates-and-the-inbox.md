# Gates and the inbox

An unattended run never blocks on a question in the middle of a session. What needs you waits in your inbox, on your computer and on your phone.

## Gates

A Gate is a Decision that a person picks. It shows the question and its options. The run continues on the option that you pick.

A Gate has two jobs:

- **Fallback.** A rule and a decider make the choices that they can. A Gate gets the rest: the ladder ran out, or a decider was not sure enough.
- **Approval.** You say yes before an act that you cannot undo, such as a sent mail, a published post, or a merge.

Give every other choice to a rule or a decider. A Gate on every result puts you back in the loop. See [Deciders](Flows-and-nodes.md#deciders).

A Gate holds more than a question:

- **A title.** A short title of at most 80 characters is the heading in the inbox. The question below it holds the details and the lists.
- **A note.** Add a note to your answer. The next steps read it.
- **Files.** Add up to 10 files to an answer, 10 MB together. The next agent steps of the run get them.
- **A deadline.** A Gate with a deadline picks its option for you when nobody answers in time.
- **The lock screen.** A Gate with two options can allow an answer from the lock screen of your phone.

Each Gate also has an urgency and a brief. They help you decide fast.

- **Urgency.** "Now", "Today" or "When you have time". The inbox groups the Gates by it. A Gate without one is "Today".
- **Situation.** Why a person must decide.
- **Background.** What is already decided, checked or done. An item can name where its fact comes from.
- **Recommendation.** The option the flow recommends, and why.
- **Impact.** Under each option: what happens when you pick it.

The flow can write each part. Night Shift writes the parts the flow leaves empty when the Gate opens, and the inbox says so. A flow can turn this off for a Gate. An Ask and an Agent's question have an urgency, a situation and a background too.

In a run with parallel branches, a Gate can open while a step on another branch still works. The inbox then shows that the run is busy. You can pick your answer, and you send it when that step ends.

An Agent can ask you a question too. Its question opens a Gate, and your answer goes back to the same session.

## Asks

An Ask is a Value that a person makes. It is a form in your inbox. Its fields come from a JSON schema.

- An Ask can have a title, as a Gate can.
- An earlier step can make the choices of a field.
- An Ask can show files from the run's copy of the project, and links. An image shows inline.
- An Ask with a deadline takes its default value when nobody answers in time. Without a default, the step fails.

The phone answers simple Asks too.

## The inbox

Every person in a Space gets its Gates and Asks in their inbox. An owner, an admin, or a member can answer. A viewer sees them, but cannot answer. See [Spaces](Computers-and-Hosts.md#spaces).

The inbox shows one Gate at a time. The Gates and Asks that wait for you, in every project, form a queue: Now, then Today, then When you have time. In each level, the Gates with a deadline come first, the earliest first. The other Gates follow, the oldest first. A row of bars at the top shows the queue, one bar for each Gate, in the colour of its level.

The Gate in focus starts with how soon it needs you: its level, its deadline and the option that Night Shift picks then. Then come the question, its brief and the links to check. The option that the flow recommends is first, with a badge.

To answer:

1. Pick an option. Click it, or press its number key.
2. Add context or files if you want. Some options need context.
3. Send. Click **Send**, or press Enter. Shift+Enter starts a new line.

Nothing goes out before you send. The next Gate then takes its place.

To move through the queue, use **Previous** and **Next**, or the arrow keys. **Skip for now** moves a Gate to the end of the queue. What you picked and wrote stays while you look at another Gate.

**Answered** shows the Gates that closed, by day, for 90 days. Each one shows the option it took, who chose it, and the run's status now. Open one to see your note, every option it offered, and what it asked. **Sleeping** shows the runs that wait on a usage limit or the network. They continue on their own.

A Gate sends a notification only for the levels that you choose. Go to Settings, Notifications, and set **Push for**. The default is Now. A Gate of another level waits in the inbox without a notification. **Push for** Now also sends a notification when a flow starts to fail again and again.

Home does not list your Gates. It shows the flows that need a look, and what your flows produced. See [Home](Runs-and-schedules.md#home).

An agent in a terminal reads the same inbox with the `needs_me` tool, and answers a Gate with `answer_gate`. See [Terminal and MCP](Terminal-and-MCP.md).
