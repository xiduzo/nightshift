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

The inbox shows the Gates and Asks that wait for you, in every project. They are in three groups: Now, Today and When you have time. The oldest Gate is first in each group. Below them are the Gates that you answered. Night Shift keeps answered Gates for 90 days.

Open a Gate to read its brief. Your answer is on the right: pick an option, add a note if you want, then send. The option that the flow recommends has a badge.

A Gate sends a notification only for the levels that you choose. Go to Settings, Notifications, and set **Push for**. The default is Now. A Gate of another level waits in the inbox without a notification.

Home shows what needs you in every project: the runs that work now, the Gates that wait, and the flows that failed.

An agent in a terminal reads the same inbox with the `needs_me` tool, and answers a Gate with `answer_gate`. See [Terminal and MCP](Terminal-and-MCP.md).
