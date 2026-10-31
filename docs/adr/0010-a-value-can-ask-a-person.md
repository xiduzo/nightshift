# 10. A Value can ask a person

Status: accepted, 2026-10-31

## Context

A Gate lets a person pick one of fixed options, each with its own edge, and
write a note. Much work needs more from a person than a pick:

- Choose one of four design variants, each with a screenshot and a preview
  link, and say what to change.
- Say which of these Jira tasks to build tonight.
- Confirm that a test scenario works, and add what went wrong.

The options of these questions come from the run: the variants an agent
made, the tasks a command found. A Gate cannot have them, because its
options are outcomes and outcomes are fixed in the flow. The
[node review](../research/node-review-2026-10.md) kept "Value by person"
for later. Today a person answers such questions in a chat session.

## Decision

1. **A Value can be made by a person.** `by: "person"` opens an Ask in the
   Needs-you inbox. The person fills in a form, and the answer is the
   step's `data`.
2. **The form comes from the output schema.** A string is a text field, an
   `enum` a choice, an array of `enum` a choice of several, a boolean a
   switch, a number a number field. The schema's descriptions are the
   hints. The answer must match the schema.
3. **Choices can come from the run.** `choices` is a template that renders
   a list. Each item has a `name`, a `label`, and optional `description`
   and `attachments`. The engine adds the names as the `enum` of the field
   that the node names.
4. **Attachments.** An item or the Ask itself can show attachments: an
   image or a file from the run's copy of the project, or a URL. Night
   Shift keeps the files with the run, so the phone can show them.
5. **Deadline.** An Ask can have a deadline, as a Gate can. `default` is
   the data it takes then.
6. **The phone answers simple forms.** A form of text, choices, switches
   and numbers is native on the phone. Other forms open the web page.
7. **A Gate stays the router.** An Ask gives data, not an outcome. A Branch
   after it routes on the data, and a Call with `each` works on each
   chosen item.

## Consequences

- "Make variants, I pick one and comment" is a flow: an Agent makes the
  variants, an Ask shows them, and an Agent builds the choice with the
  note.
- The person tier of a Value cascade
  ([ADR 6](0006-a-cascade-climbs-tiers.md)) is an Ask, filled in with the
  best answer of the models.
- The phone gets a form screen. Its first version covers the simple types
  of decision 6.
