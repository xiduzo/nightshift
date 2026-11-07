# Gates and the inbox

An unattended run never blocks on a question in the middle of a session. What needs you waits in your inbox, on your computer and on your phone.

## Gates

A Gate is a Decision that a person picks. It shows the question and its options. The run continues on the option that you pick.

- **A note.** Add a note to your answer. The next steps read it.
- **Files.** Add up to 10 files to an answer, 10 MB together. The next agent steps of the run get them.
- **A deadline.** A Gate with a deadline picks its option for you when nobody answers in time.
- **The lock screen.** A Gate with two options can allow an answer from the lock screen of your phone.

An Agent can ask you a question too. Its question opens a Gate, and your answer goes back to the same session.

## Asks

An Ask is a Value that a person makes. It is a form in your inbox. Its fields come from a JSON schema.

- An earlier step can make the choices of a field.
- An Ask can show files from the run's copy of the project, and links. An image shows inline.
- An Ask with a deadline takes its default value when nobody answers in time. Without a default, the step fails.

The phone answers simple Asks too.

## The inbox

| Tab | Shows |
| --- | --- |
| **Waiting for you** | The Gates and Asks that wait, in every project. |
| **Daily digest** | What happened since the last digest: the runs that ended, and what still waits. |

Night Shift keeps answered Gates and digests for 90 days.

An agent in a terminal reads the same inbox with the `needs_me` tool, and answers a Gate with `answer_gate`. See [Terminal and MCP](Terminal-and-MCP.md).
