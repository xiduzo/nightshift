# 38. The message box can pick who answers

Status: accepted, 2026-11-14. Built, 2026-11-14. Changes the consequence of
[ADR 35](0035-night-shift-has-six-agents-of-its-own.md) that removed the picker under
the prompt box.

## Context

ADR 35 made Settings the one place that chooses who answers for each built-in agent. The
chat and the Suggest popovers lost their picker. The chat showed the choice only as a
quiet link in its header.

A person often wants another model or effort for one ask: a stronger model for a hard
change, a cheap one for a small field. They had to change Settings, ask, and change it
back. Quick run already has the menus for this under its prompt box.

## Decision

1. **Settings holds the default.** The choice of ADR 35, decision 3 stays. It is what
   answers when the person picks nothing.
2. **Every message box that asks a built-in agent shows who answers.** The chat (Builder,
   Improver) and Suggest (Field writer) have the menus of quick run under the text: the
   agent, and the effort. The menu starts on **Default**, which shows what answers in
   Settings.
3. **A pick holds for that place only.** It holds in the open chat until **New chat**,
   and in a Suggest popover until it closes. Settings does not change. **Default** goes
   back. **Change the default…** opens the agent's page in Settings.
4. **A pick changes who answers, never the job.** The built-in agent keeps its prompt,
   its tools, its limits and its kind. The menu offers only what the agent takes: an
   agent with Night Shift's tools for the Builder and the Improver, an agent or a model
   for the Field writer.
5. **The request says who answers.** The web sends what the menu shows, the default
   included, so a chat that had another agent comes back to the default. A suggestion
   request takes a model too (`modelAnswer`). A request that picks nothing still gets
   the choice in Settings.

## Consequences

- The link with the default in the chat header is gone. The menu in the message box
  shows it.
- "Ask why" has no message box. It still answers with the default of the Explainer.
- The phone has no picker. It asks the Host, which answers with its own defaults.
- An older daemon ignores `modelAnswer`. A model pick there gets the choice in Settings.
