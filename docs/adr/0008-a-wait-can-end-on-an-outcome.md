# 8. A Wait can end on an outcome

Status: accepted, 2026-10-31

## Context

A Wait ends `done` or `timeout`. A command it polls must exit 0 to end the
wait. Most waits ask a question with more than one answer: the checks of a
pull request are green or red, a merge queue merges or ejects a pull
request, a deploy succeeds or fails. Flows answer it with a polling Wait,
then a Command that asks again, then a Branch. Person sessions do it with
`until gh pr checks` loops, many times a week.

A webhook signal wakes a Wait, but every signal of that name and key wakes
it, whatever the event says. A missed webhook leaves the Wait asleep until
its timeout.

## Decision

1. **A Wait can list outcomes.** Without `outcomes`, a Wait works as
   today.
2. **A polled command picks an outcome.** It writes
   `{ "outcome": "red" }` to `$NS_OUTPUT`, as a Command does. An outcome
   that the Wait lists ends the wait there, with the command's data. No
   outcome, or exit code not 0: the Wait polls again. Exit 0 without an
   outcome ends `done`.
3. **A signal picks an outcome by rule.** Each outcome of a signal Wait
   can have a `when` rule (JSONata) over the signal's data. The first rule
   that holds ends the wait there. A signal that matches no rule does not
   wake the Wait.
4. **A Wait can wait for the first of several things.** `until` of kind
   `any` lists a signal and a command, for example a webhook with a
   polling command every 10 minutes as a backup. The first one that ends
   the wait wins.
5. **A kit for pull requests.** `kit:github/watch-pr` waits on the
   checks, the review and the merge queue of one pull request. Its
   outcomes are `green`, `red`, `merged`, `closed` and `ejected`.

A separate Watch node is not needed: these are a Wait with more than one
way out.

## Consequences

- A Wait on CI is one node with a webhook and a polling backup, instead of
  a Wait, a Command and a Branch.
- `kit:github/wait-for-checks` stays, for flows that only need "green".
- The validator checks that each listed outcome has an edge, as for other
  nodes.
